import uuid
from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Member, Transaction, TransactionType
from app.schemas import (
    LedgerResponse,
    LedgerRow,
    LedgerSummary,
    Settlement,
    SplitResponse,
    SplitTx,
    UpiBucket,
    UpiSummaryResponse,
)

router = APIRouter(prefix="/views", tags=["views"])


def _month_bounds(month: str) -> tuple[date, date]:
    try:
        y, m = int(month[:4]), int(month[5:7])
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    start = date(y, m, 1)
    end = date(y + (m == 12), (m % 12) + 1, 1)
    return start, end


def _fetch(month: str, member_id: uuid.UUID | None, db: Session):
    start, end = _month_bounds(month)
    q = (
        db.query(Transaction)
        .options(
            joinedload(Transaction.member),
            joinedload(Transaction.shared_with),
            joinedload(Transaction.account),
        )
        .filter(Transaction.date >= start, Transaction.date < end)
    )
    if member_id:
        q = q.filter(Transaction.member_id == member_id)
    return q.order_by(Transaction.date.asc(), Transaction.created_at.asc()).all()


def _row(t: Transaction) -> LedgerRow:
    return LedgerRow(
        id=t.id,
        date=t.date,
        description=t.description,
        remarks=t.remarks,
        category=t.category,
        counterparty=t.counterparty,
        counterparty_upi=t.counterparty_upi,
        amount=float(t.amount),
        type=t.type,
        is_shared=t.is_shared,
        member_name=t.member.name if t.member else "?",
        shared_with_name=t.shared_with.name if t.shared_with else None,
        account_name=t.account.name if t.account else None,
    )


@router.get("/ledger", response_model=LedgerResponse)
def monthly_ledger(
    month: str,
    member_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
):
    txs = _fetch(month, member_id, db)
    spent = sum(float(t.amount) for t in txs if t.type == TransactionType.debit)
    received = sum(float(t.amount) for t in txs if t.type == TransactionType.credit)
    shared_spent = sum(
        float(t.amount) for t in txs if t.is_shared and t.type == TransactionType.debit
    )
    by_cat: dict[str, float] = defaultdict(float)
    for t in txs:
        if t.type == TransactionType.debit:
            by_cat[t.category.value] += float(t.amount)

    return LedgerResponse(
        summary=LedgerSummary(
            month=month,
            total_spent=round(spent, 2),
            total_received=round(received, 2),
            net=round(received - spent, 2),
            shared_spent=round(shared_spent, 2),
            transactions=len(txs),
            by_category=dict(by_cat),
        ),
        rows=[_row(t) for t in txs],
    )


@router.get("/upi-summary", response_model=UpiSummaryResponse)
def upi_summary(
    month: str,
    member_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
):
    """'Paid this UPI ID month-wise': group debit transactions by the payee VPA
    (falls back to description-derived counterparty when no VPA is present)."""
    txs = _fetch(month, member_id, db)
    spent = sum(float(t.amount) for t in txs if t.type == TransactionType.debit)

    buckets: dict[str, dict] = {}
    for t in txs:
        if t.type != TransactionType.debit:
            continue
        key = (t.counterparty_upi or "").strip() or (t.counterparty or "").strip() or "other"
        b = buckets.setdefault(
            key,
            {
                "upi": t.counterparty_upi,
                "name": t.counterparty,
                "count": 0,
                "total": 0.0,
                "shared": 0.0,
                "rows": [],
            },
        )
        if not b["upi"] and t.counterparty_upi:
            b["upi"] = t.counterparty_upi
        if not b["name"] and t.counterparty:
            b["name"] = t.counterparty
        amt = float(t.amount)
        b["count"] += 1
        b["total"] += amt
        if t.is_shared:
            b["shared"] += amt
        b["rows"].append(_row(t))

    out = []
    for key, b in sorted(buckets.items(), key=lambda kv: -kv[1]["total"]):
        out.append(
            UpiBucket(
                counterparty_upi=b["upi"] or (key if "@" in key else None),
                counterparty=b["name"],
                count=b["count"],
                total=round(b["total"], 2),
                shared_total=round(b["shared"], 2),
                transactions=b["rows"],
            )
        )
    return UpiSummaryResponse(
        month=month, total_spent=round(spent, 2), buckets=out
    )


@router.get("/split", response_model=SplitResponse)
def split_view(
    month: str,
    member_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
):
    """Split-wise view: how each shared ('both') transaction splits 50/50
    between the payer and the other person, and the net settlement per pair."""
    txs = _fetch(month, member_id, db)
    shared = [t for t in txs if t.is_shared and t.type == TransactionType.debit]

    trans: list[SplitTx] = []
    for t in shared:
        payer = t.member.name if t.member else "?"
        other = t.shared_with.name if t.shared_with else None
        trans.append(
            SplitTx(
                id=t.id,
                date=t.date,
                description=t.description,
                amount=round(float(t.amount), 2),
                payer=payer,
                other=other,
                each_pays=round(float(t.amount) / 2, 2) if other else None,
            )
        )

    # debt[payer][other] += half — other owes payer half
    debt: dict[tuple[str, str], float] = defaultdict(float)
    for t in shared:
        if t.shared_with and t.member:
            debt[(t.member.name, t.shared_with.name)] += float(t.amount) / 2

    settlements: list[Settlement] = []
    seen: set[tuple[str, str]] = set()
    for (a, b), v in debt.items():
        if (b, a) in seen or (a, b) in seen:
            continue
        seen.add((a, b))
        net = v - debt.get((b, a), 0.0)
        if abs(net) < 0.005:
            continue
        if net > 0:
            settlements.append(Settlement(owes=b, to=a, amount=round(net, 2)))
        else:
            settlements.append(Settlement(owes=a, to=b, amount=round(-net, 2)))
    settlements.sort(key=lambda s: -s.amount)

    return SplitResponse(
        month=month,
        shared_count=len(shared),
        shared_total=round(sum(float(t.amount) for t in shared), 2),
        unsettled_count=sum(1 for t in shared if not t.shared_with),
        transactions=trans,
        settlements=settlements,
    )


@router.get("/members-summary")
def members_summary(db: Session = Depends(get_db)):
    """Settlement overview: what each member paid and, for shared transactions,
    who owes whom. Split is assumed 50/50."""
    members = db.query(Member).all()
    txs = db.query(Transaction).all()
    paid: dict[uuid.UUID, float] = defaultdict(float)
    for t in txs:
        if t.type == TransactionType.debit:
            paid[t.member_id] += float(t.amount)

    # (payer, shared_with) -> shared amount. payer should get half back.
    shared_pairs: dict[tuple[uuid.UUID, uuid.UUID], float] = defaultdict(float)
    for t in txs:
        if t.is_shared and t.shared_with_id and t.type == TransactionType.debit:
            shared_pairs[(t.member_id, t.shared_with_id)] += float(t.amount) / 2

    result = []
    for m in members:
        result.append(
            {
                "id": str(m.id),
                "name": m.name,
                "phone_model": m.phone_model,
                "total_paid": round(paid.get(m.id, 0), 2),
                "shared_paid": round(
                    sum(v for (p, _), v in shared_pairs.items() if p == m.id), 2
                ),
            }
        )
    return {"members": result, "shared_pairs": {f"{p}|{s}": v for (p, s), v in shared_pairs.items()}}
