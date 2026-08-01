import os
import uuid

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.classify import classify, guess_counterparty
from app.database import get_db
from app.models import Member
from app.pdf_parser import parse_pdf, ParseResult, ParsedRow
from app.schemas import ParsedAccount, ParsedTx, UploadPreview

router = APIRouter(prefix="/upload", tags=["upload"])


def _get_member_or_403(db: Session, device_id: str | None) -> Member:
    if not device_id:
        raise HTTPException(status_code=403, detail="No device id provided")
    member = db.query(Member).filter(Member.device_id == device_id).first()
    if not member:
        raise HTTPException(
            status_code=403,
            detail="Device not registered. Register your name first.",
        )
    return member


def _to_preview(
    result: ParseResult, member: Member, other_members: list[Member]
) -> list[ParsedTx]:
    other_ids = [m.id for m in other_members if m.id != member.id]
    out = []
    for r in result.rows:
        category, is_shared, shared_with = classify(
            r.description, r.remarks, r.type, other_ids
        )
        counterparty = guess_counterparty(r.description, r.counterparty_upi)
        shared_hint = None
        if is_shared and shared_with:
            for m in other_members:
                if m.id == shared_with:
                    shared_hint = m.name
        out.append(
            ParsedTx(
                date=r.date,
                description=r.description,
                remarks=r.remarks,
                amount=r.amount,
                type=r.type,
                category=category,
                counterparty=counterparty,
                counterparty_upi=r.counterparty_upi,
                upi_ref=r.upi_ref,
                is_shared=is_shared,
                shared_hint=shared_hint,
            )
        )
    return out


@router.post("", response_model=UploadPreview)
async def upload_statement(
    file: UploadFile = File(...),
    x_device_id: str | None = Header(default=None),
    device_id: str | None = None,
    db: Session = Depends(get_db),
):
    device_id = device_id or x_device_id
    member = _get_member_or_403(db, device_id)
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 25 MB)")

    tmp_path = f"/tmp/fin-fy-{uuid.uuid4().hex}.pdf"
    with open(tmp_path, "wb") as f:
        f.write(content)

    other_members = db.query(Member).all()
    try:
        result = parse_pdf(tmp_path, [m.id for m in other_members])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Failed to parse PDF: {exc}")
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    preview = _to_preview(result, member, other_members)
    return UploadPreview(
        account=ParsedAccount(name=result.account_name, upi_id=result.account_upi),
        transactions=preview,
        skipped=0,
        warnings=result.warnings,
        source_file=file.filename,
    )
