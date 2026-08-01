from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.device import detect_phone_model
from app.models import Member
from app.schemas import MemberOut, MemberRegister

router = APIRouter(prefix="/members", tags=["members"])


def _member_out(m: Member) -> MemberOut:
    return MemberOut(
        id=m.id,
        name=m.name,
        upi_id=m.upi_id,
        phone_model=m.phone_model,
        device_id=m.device_id,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


@router.get("", response_model=list[MemberOut])
def list_members(db: Session = Depends(get_db)):
    return [_member_out(m) for m in db.query(Member).order_by(Member.name).all()]


@router.get("/me", response_model=MemberOut | None)
def get_me(device_id: str, db: Session = Depends(get_db)):
    m = db.query(Member).filter(Member.device_id == device_id).first()
    return _member_out(m) if m else None


@router.post("/register", response_model=MemberOut)
def register(payload: MemberRegister, request: Request, db: Session = Depends(get_db)):
    existing = db.query(Member).filter(Member.device_id == payload.device_id).first()
    if existing:
        # same device re-registering: update name/upi if provided
        existing.name = payload.name
        if payload.upi_id:
            existing.upi_id = payload.upi_id
        existing.phone_model = detect_phone_model(request.headers.get("user-agent"))
        existing.user_agent = request.headers.get("user-agent")
        db.commit()
        db.refresh(existing)
        return _member_out(existing)

    # new device: bind to phone model detected from the UA header
    member = Member(
        name=payload.name,
        upi_id=payload.upi_id,
        device_id=payload.device_id,
        phone_model=detect_phone_model(request.headers.get("user-agent")),
        user_agent=request.headers.get("user-agent"),
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return _member_out(member)


@router.delete("/{member_id}")
def delete_member(member_id, db: Session = Depends(get_db)):
    m = db.get(Member, member_id)
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    db.delete(m)
    db.commit()
    return {"ok": True}
