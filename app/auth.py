"""Device fingerprint authentication.

The device fingerprint (computed client-side from canvas/WebGL/UA/screen/etc.)
is the primary access credential: a member's transactions can only be reached
from a device whose fingerprint is bound to that member.

The fingerprint alone is not proof of identity (it can't be — a fingerprint is
just a consistent device identifier), so re-binding a new device to an existing
member requires that member's PIN.
"""

import hashlib
import hmac
import json
import secrets
from typing import TYPE_CHECKING

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db

if TYPE_CHECKING:
    from app.models import Member

MAX_FINGERPRINTS = 3  # keep the last N to tolerate browser-update drift
DEVICE_NOT_RECOGNIZED = "device_not_recognized"


# ---------- pin ----------


def hash_pin(pin: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(8)
    digest = hashlib.sha256((pin + salt).encode()).hexdigest()
    return digest, salt


def verify_pin(member: "Member", pin: str) -> bool:
    if not member.pin_hash or not member.pin_salt:
        return False
    candidate, _ = hash_pin(pin, member.pin_salt)
    return hmac.compare_digest(candidate, member.pin_hash)


# ---------- fingerprints ----------


def get_fingerprints(member: "Member") -> list[str]:
    try:
        return json.loads(member.fingerprints) if member.fingerprints else []
    except (ValueError, TypeError):
        return []


def add_fingerprint(member: "Member", fingerprint: str) -> None:
    fps = [f for f in get_fingerprints(member) if f != fingerprint]
    fps.append(fingerprint)
    member.fingerprints = json.dumps(fps[-MAX_FINGERPRINTS:])


def fingerprint_known(member: "Member", fingerprint: str) -> bool:
    return fingerprint in get_fingerprints(member)


# ---------- fastapi dependency ----------


def require_member(
    x_device_fp: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> "Member":
    """Resolve the member whose device fingerprint matches the request."""
    if not x_device_fp or len(x_device_fp) < 16:
        raise HTTPException(status_code=403, detail=DEVICE_NOT_RECOGNIZED)

    member = _find_by_fingerprint(db, x_device_fp)
    if member is None:
        raise HTTPException(status_code=403, detail=DEVICE_NOT_RECOGNIZED)
    return member


def _find_by_fingerprint(db: Session, fingerprint: str) -> "Member | None":
    from app.models import Member

    for member in db.query(Member).filter(Member.fingerprints.is_not(None)).all():
        if fingerprint_known(member, fingerprint):
            return member
    return None
