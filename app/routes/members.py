from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth import (
    DEVICE_NOT_RECOGNIZED,
    add_fingerprint,
    fingerprint_known,
    hash_pin,
    require_member,
    verify_pin,
)
from app.database import get_db
from app.device import detect_phone_model
from app.models import Member
from app.schemas import MemberOut, MemberRegister

router = APIRouter(prefix="/members", tags=["members"])

MIN_PIN_LEN = 4


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
def list_members(
    _member: Member = Depends(require_member),
    db: Session = Depends(get_db),
):
    return [_member_out(m) for m in db.query(Member).order_by(Member.name).all()]


@router.get("/me", response_model=MemberOut | None)
def get_me(
    x_device_fp: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Resolve who this device is. 403 (device_not_recognized) when the
    fingerprint isn't bound to any member."""
    if not x_device_fp or len(x_device_fp) < 16:
        return None
    member = require_member(x_device_fp=x_device_fp, db=db)
    return _member_out(member)


@router.post("/register", response_model=MemberOut)
def register(
    payload: MemberRegister,
    request: Request,
    x_device_fp: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Bind this device to a member.

    1. Fingerprint already bound to a member  -> auto-login (that member).
    2. Name matches an existing member        -> require that member's PIN,
       then re-bind this device to them.
    3. Otherwise                              -> create a new member (PIN set
       here is the key that lets you re-bind another device later).
    """
    fingerprint = (x_device_fp or "").strip()
    if len(fingerprint) < 16:
        raise HTTPException(status_code=400, detail="Missing device fingerprint")

    ua = request.headers.get("user-agent")
    phone_model = detect_phone_model(ua)

    # 1. auto-login by fingerprint
    from app.auth import _find_by_fingerprint

    existing = _find_by_fingerprint(db, fingerprint)
    if existing:
        existing.device_id = payload.device_id or existing.device_id
        existing.phone_model = phone_model or existing.phone_model
        existing.user_agent = ua or existing.user_agent
        db.commit()
        db.refresh(existing)
        return _member_out(existing)

    # 2. claiming an existing member's identity -> PIN required
    by_name = db.query(Member).filter(Member.name == payload.name).first()
    if by_name:
        if not payload.pin or not verify_pin(by_name, payload.pin):
            raise HTTPException(
                status_code=409,
                detail="That name is taken. Enter the PIN set for it to use this device.",
            )
        add_fingerprint(by_name, fingerprint)
        by_name.device_id = payload.device_id or by_name.device_id
        by_name.phone_model = phone_model or by_name.phone_model
        by_name.user_agent = ua or by_name.user_agent
        db.commit()
        db.refresh(by_name)
        return _member_out(by_name)

    # 3. new member
    pin_hash, pin_salt = (hash_pin(payload.pin) if payload.pin else (None, None))
    member = Member(
        name=payload.name,
        upi_id=payload.upi_id,
        device_id=payload.device_id,
        phone_model=phone_model,
        user_agent=ua,
        pin_hash=pin_hash,
        pin_salt=pin_salt,
    )
    add_fingerprint(member, fingerprint)
    db.add(member)
    db.commit()
    db.refresh(member)
    return _member_out(member)


@router.delete("/{member_id}")
def delete_member(
    member_id,
    member: Member = Depends(require_member),
    db: Session = Depends(get_db),
):
    target = db.get(Member, member_id)
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    if target.id != member.id:
        raise HTTPException(status_code=403, detail="You can only delete your own member")
    db.delete(target)
    db.commit()
    return {"ok": True}
