import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import require_member
from app.database import get_db
from app.models import Account, Member, Transaction, TransactionType
from app.schemas import (
    AccountOut,
    BatchCreate,
    BatchResult,
    TransactionOut,
    TransactionStatusUpdate,
)

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _tx_out(t: Transaction) -> TransactionOut:
    return TransactionOut(
        id=t.id,
        member_id=t.member_id,
        account_id=t.account_id,
        date=t.date,
        description=t.description,
        remarks=t.remarks,
        category=t.category,
        counterparty=t.counterparty,
        counterparty_upi=t.counterparty_upi,
        upi_ref=t.upi_ref,
        amount=float(t.amount),
        type=t.type,
        is_shared=t.is_shared,
        shared_with_id=t.shared_with_id,
        source_file=t.source_file,
        status=t.status,
        created_at=t.created_at,
        updated_at=t.updated_at,
        member_name=t.member.name if t.member else None,
        shared_with_name=t.shared_with.name if t.shared_with else None,
        account_name=t.account.name if t.account else None,
    )


@router.get("", response_model=list[TransactionOut])
def list_transactions(
    member_id: uuid.UUID | None = None,
    month: str | None = None,  # YYYY-MM
    db: Session = Depends(get_db),
):
    q = db.query(Transaction).options(
        joinedload(Transaction.member), joinedload(Transaction.shared_with)
    )
    if member_id:
        q = q.filter(Transaction.member_id == member_id)
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail="month must be YYYY-MM")
        q = q.filter(
            Transaction.date >= date(y, m, 1),
            Transaction.date < date(y + (m == 12), (m % 12) + 1, 1),
        )
    return [_tx_out(t) for t in q.order_by(Transaction.date.desc()).all()]


@router.delete("/{tx_id}")
def delete_transaction(
    tx_id: uuid.UUID,
    member: Member = Depends(require_member),
    db: Session = Depends(get_db),
):
    t = db.get(Transaction, tx_id)
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if t.member_id != member.id:
        raise HTTPException(status_code=403, detail="You can only delete your own transactions")
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.patch("/{tx_id}/status")
def update_status(
    tx_id: uuid.UUID,
    payload: TransactionStatusUpdate,
    member: Member = Depends(require_member),
    db: Session = Depends(get_db),
):
    t = db.get(Transaction, tx_id)
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if t.member_id != member.id:
        raise HTTPException(status_code=403, detail="You can only update your own transactions")
    t.status = payload.status
    db.commit()
    return {"ok": True, "status": payload.status.value}


@router.post("/batch", response_model=BatchResult)
def create_batch(
    payload: BatchCreate,
    member: Member = Depends(require_member),
    db: Session = Depends(get_db),
):
    """Save a reviewed batch of parsed transactions for the authenticated member."""
    member_id = member.id

    account = None
    if payload.account_id:
        account = db.get(Account, payload.account_id)
    elif payload.account:
        account = Account(
            member_id=member_id,
            name=payload.account.name or "Statement Account",
            upi_id=payload.account.upi_id,
        )
        db.add(account)
        db.flush()

    created = 0
    for tx in payload.transactions:
        data = tx.model_dump()
        if tx.is_shared and tx.shared_with_id == member_id:
            data["shared_with_id"] = None
        row = Transaction(
            member_id=member_id,
            account_id=account.id if account else None,
            source_file=payload.source_file,
            **data,
        )
        db.add(row)
        created += 1
    db.commit()
    return BatchResult(created=created, account_id=account.id if account else None)


@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(db: Session = Depends(get_db)):
    return db.query(Account).all()
