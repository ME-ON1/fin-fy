import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.models import Category, TransactionType


class TimestampMixin(BaseModel):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------- Members / device namespace ----------


class MemberRegister(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    device_id: str = Field(min_length=8, max_length=64)
    upi_id: str | None = None
    pin: str | None = Field(default=None, min_length=4, max_length=64)


class MemberOut(TimestampMixin):
    name: str
    upi_id: str | None
    phone_model: str | None
    device_id: str | None


# ---------- Accounts ----------


class AccountOut(TimestampMixin):
    member_id: uuid.UUID
    name: str
    upi_id: str | None


# ---------- Transactions ----------


class TransactionCreate(BaseModel):
    date: date
    description: str
    remarks: str | None = None
    category: Category = Category.other
    counterparty: str | None = None
    counterparty_upi: str | None = None
    upi_ref: str | None = None
    amount: float
    type: TransactionType
    is_shared: bool = False
    shared_with_id: uuid.UUID | None = None


class TransactionOut(TimestampMixin):
    member_id: uuid.UUID
    account_id: uuid.UUID | None
    date: date
    description: str
    remarks: str | None
    category: Category
    counterparty: str | None
    counterparty_upi: str | None
    upi_ref: str | None
    amount: float
    type: TransactionType
    is_shared: bool
    shared_with_id: uuid.UUID | None
    source_file: str | None

    member_name: str | None = None
    shared_with_name: str | None = None
    account_name: str | None = None


# ---------- Upload / parse preview ----------


class ParsedTx(BaseModel):
    date: date
    description: str
    remarks: str | None = None
    amount: float
    type: TransactionType
    category: Category
    counterparty: str | None = None
    counterparty_upi: str | None = None
    upi_ref: str | None = None
    is_shared: bool = False
    shared_hint: str | None = None


class ParsedAccount(BaseModel):
    name: str | None = None
    upi_id: str | None = None


class UploadPreview(BaseModel):
    account: ParsedAccount | None = None
    transactions: list[ParsedTx]
    skipped: int = 0
    warnings: list[str] = []
    source_file: str


class BatchCreate(BaseModel):
    account_id: uuid.UUID | None = None
    account: ParsedAccount | None = None
    transactions: list[TransactionCreate] = Field(min_length=1)
    source_file: str | None = None


class BatchResult(BaseModel):
    created: int
    account_id: uuid.UUID | None


# ---------- Views ----------


class LedgerRow(BaseModel):
    id: uuid.UUID
    date: date
    description: str
    remarks: str | None
    category: Category
    counterparty: str | None
    counterparty_upi: str | None
    amount: float
    type: TransactionType
    is_shared: bool
    member_name: str
    shared_with_name: str | None
    account_name: str | None


class LedgerSummary(BaseModel):
    month: str
    total_spent: float
    total_received: float
    net: float
    shared_spent: float
    transactions: int
    by_category: dict[str, float]


class LedgerResponse(BaseModel):
    summary: LedgerSummary
    rows: list[LedgerRow]


class UpiBucket(BaseModel):
    counterparty_upi: str | None
    counterparty: str | None
    count: int
    total: float
    shared_total: float
    transactions: list[LedgerRow]


class UpiSummaryResponse(BaseModel):
    month: str
    total_spent: float
    buckets: list[UpiBucket]


class SplitTx(BaseModel):
    id: uuid.UUID
    date: date
    description: str
    amount: float
    payer: str
    other: str | None
    each_pays: float | None


class Settlement(BaseModel):
    owes: str  # pays
    to: str  # receives
    amount: float


class SplitResponse(BaseModel):
    month: str
    shared_count: int
    shared_total: float
    unsettled_count: int
    transactions: list[SplitTx]
    settlements: list[Settlement]
