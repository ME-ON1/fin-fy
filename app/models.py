import enum
import uuid
from datetime import date, datetime
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TransactionType(str, enum.Enum):
    credit = "credit"
    debit = "debit"


class Category(str, enum.Enum):
    groceries = "groceries"
    transport = "transport"
    food = "food"
    shopping = "shopping"
    utilities = "utilities"
    health = "health"
    entertainment = "entertainment"
    income = "income"
    transfer = "transfer"
    other = "other"


class Member(Base):
    """A person in the ledger namespace. Each uploader gets a Member row,
    bound to the device (phone model + browser token) they upload from."""

    __tablename__ = "members"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120))
    upi_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Device fingerprinting
    phone_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    device_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Device fingerprint (JSON list of the last few accepted fingerprints,
    # for drift tolerance across browser updates). Primary access credential.
    fingerprints: Mapped[str | None] = mapped_column(Text, nullable=True)

    # PIN (hashed) — used to re-bind a new/unknown device to this member.
    pin_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    pin_salt: Mapped[str | None] = mapped_column(String(32), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP")
    )

    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="member", foreign_keys="Transaction.member_id"
    )
    accounts: Mapped[list["Account"]] = relationship(back_populates="member")


class Account(Base):
    """A bank account / UPI handle that money flows out of. Detected from the
    statement header of an uploaded PDF."""

    __tablename__ = "accounts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"))
    name: Mapped[str] = mapped_column(String(255))  # e.g. "Paytm Payments Bank"
    upi_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP")
    )

    member: Mapped["Member"] = relationship(back_populates="accounts")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="account")


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id"), index=True
    )
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("accounts.id"), nullable=True
    )

    date: Mapped[date] = mapped_column(Date, index=True)
    description: Mapped[str] = mapped_column(String(500))
    remarks: Mapped[str | None] = mapped_column(String(500), nullable=True)
    category: Mapped[Category] = mapped_column(
        Enum(Category), default=Category.other
    )
    counterparty: Mapped[str | None] = mapped_column(String(255), nullable=True)
    counterparty_upi: Mapped[str | None] = mapped_column(String(255), nullable=True)
    upi_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)

    amount: Mapped[float] = mapped_column(Numeric(12, 2))
    type: Mapped[TransactionType] = mapped_column(Enum(TransactionType))

    # "both" sharing: another person is involved, split 50/50 by default.
    is_shared: Mapped[bool] = mapped_column(Boolean, default=False)
    shared_with_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), nullable=True
    )

    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP")
    )

    member: Mapped["Member"] = relationship(
        back_populates="transactions", foreign_keys=[member_id]
    )
    shared_with: Mapped["Member | None"] = relationship(foreign_keys=[shared_with_id])
    account: Mapped["Account | None"] = relationship(back_populates="transactions")
