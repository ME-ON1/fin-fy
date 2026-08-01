"""Tolerant PDF statement parser.

Handles the common Indian UPI/bank statement layouts:
  - PhonePe / GPay / Paytm "UPI statement" PDFs
    (columns: Date | UPI Ref No | Description | Remarks | Amount | UPI ID)
  - Bank statements with a single amount + Dr/Cr flag, or separate
    withdrawal/deposit columns, plus a trailing balance column.

It does not depend on any single layout: we locate columns by scanning table
headers, then classify cells by shape (dates, amounts, Dr/Cr tokens, VPAs).
Everything the parser gets wrong can be fixed in the upload preview screen.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime

import pdfplumber

from app.classify import classify
from app.models import Category, TransactionType

DATE_PATTERNS = [
    re.compile(r"(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})"),          # 12/08/2026
    re.compile(r"(\d{1,2})\s+([A-Za-z]{3})[,.]?\s+(\d{4})"),     # 12 Aug 2026
    re.compile(r"([A-Za-z]{3})\s+(\d{1,2})[,.]?\s+(\d{4})"),     # Aug 12, 2026
]
MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
)}
AMOUNT_RE = re.compile(r"^-?\s*[₹,0-9][0-9,]*\.?\d{0,2}$")
UPI_RE = re.compile(r"[A-Za-z0-9._-]+@[A-Za-z]+")
REF_RE = re.compile(r"^(UPI|TXN|REF)[A-Z0-9]+$", re.IGNORECASE)


@dataclass
class ParsedRow:
    date: date
    description: str
    remarks: str | None
    amount: float
    type: TransactionType
    counterparty_upi: str | None
    upi_ref: str | None


@dataclass
class ParseResult:
    account_name: str | None = None
    account_upi: str | None = None
    rows: list[ParsedRow] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _parse_date(token: str) -> date | None:
    token = token.strip()
    for pat in DATE_PATTERNS:
        m = pat.search(token)
        if not m:
            continue
        try:
            if pat is DATE_PATTERNS[0]:
                d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            elif pat is DATE_PATTERNS[1]:
                d, mo, y = int(m.group(1)), MONTHS[m.group(2).lower()[:3]], int(m.group(3))
            else:
                d, mo, y = int(m.group(2)), MONTHS[m.group(1).lower()[:3]], int(m.group(3))
            if y < 100:
                y += 2000
            return date(y, mo, d)
        except ValueError:
            continue
    return None


def _parse_amount(token: str) -> float | None:
    t = token.strip().replace(",", "").replace("₹", "").replace("Rs.", "").replace(" ", "")
    if not t or not AMOUNT_RE.match(t):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _clean(token: str) -> str:
    return " ".join(token.split())


def _is_upi(token: str) -> str | None:
    t = _clean(token)
    m = UPI_RE.fullmatch(t)
    return m.group(0) if m else None


def _looks_like_balance(text: str) -> bool:
    return bool(re.search(r"\bbalance\b", text, re.IGNORECASE))


def _extract_header(text: str, result: ParseResult) -> None:
    """Pull account name / UPI ID / period from the statement header."""
    lines = text.splitlines()
    for i, line in enumerate(lines[:40]):
        low = line.lower()
        if "upi id" in low or "vpa" in low:
            m = UPI_RE.search(line)
            if m:
                result.account_upi = m.group(0)
                if not result.account_name:
                    result.account_name = "UPI Account"
        if ("account" in low or "statement" in low) and not result.account_name:
            # e.g. "HDFC Bank Account", "Paytm Payments Bank"
            name = _clean(re.sub(r"\s*(account|statement).*$", "", line, flags=re.IGNORECASE))
            if name and len(name) < 60 and not re.search(r"\d{6,}", name):
                result.account_name = name
    # period line e.g. "From 01/08/2026 To 31/08/2026"
    for line in lines[:40]:
        m = re.search(r"from\s+([\d/A-Za-z-]+)\s+to\s+([\d/A-Za-z-]+)", line, re.IGNORECASE)
        if m:
            result.warnings.append(f"Statement period: {m.group(1)} to {m.group(2)}")


def _detect_columns(header_row: list[str]) -> dict[str, int]:
    """Map column names -> index. Returns keys: date, desc, remarks, amount,
    credit, debit, upi, ref. Tolerant of noisy header cells."""
    cols: dict[str, int] = {}
    for i, raw in enumerate(header_row):
        cell = raw.lower()
        joined = re.sub(r"[^a-z]", "", cell)
        if "date" in joined and "value" not in joined and "due" not in joined:
            cols.setdefault("date", i)
        elif "remarks" in joined:
            cols.setdefault("remarks", i)
        elif "upiid" in joined or joined in ("upi", "vpa") or "upistatement" in joined and "id" in joined:
            cols.setdefault("upi", i)
        elif any(k in joined for k in ("withdrawal", "debit", "debitamt", "debitamount")):
            cols.setdefault("debit", i)
        elif any(k in joined for k in ("deposit", "credit", "creditamt", "creditamount")):
            cols.setdefault("credit", i)
        elif "ref" in joined or "txn" in joined or "transactionid" in joined or "tranid" in joined:
            cols.setdefault("ref", i)
        elif "amount" in joined:
            cols.setdefault("amount", i)
        elif "narration" in joined or "description" in joined or "particular" in joined or "details" in joined:
            cols.setdefault("desc", i)
        elif "balance" in joined:
            cols.setdefault("balance", i)
    return cols


def _row_to_parsed(cells: list[str], cols: dict[str, int]) -> ParsedRow | None:
    """Turn one raw table row into a ParsedRow, or None if it isn't a
    transaction row (header/empty/balance-only)."""
    cleaned = [_clean(c) for c in cells]

    date_idx = cols.get("date")
    d = None
    if date_idx is not None and date_idx < len(cleaned):
        d = _parse_date(cleaned[date_idx])
    if d is None:
        # fallback: any cell that parses as a date
        for i, c in enumerate(cleaned):
            dd = _parse_date(c)
            if dd:
                d = dd
                date_idx = i
                break
    if d is None:
        return None

    # --- amount & type ---
    amount: float | None = None
    type_: TransactionType | None = None

    debit_idx, credit_idx = cols.get("debit"), cols.get("credit")
    if debit_idx is not None and credit_idx is not None:
        # separate debit/credit columns
        dv = _parse_amount(cleaned[debit_idx]) if debit_idx < len(cleaned) else None
        cv = _parse_amount(cleaned[credit_idx]) if credit_idx < len(cleaned) else None
        if dv:
            amount, type_ = dv, TransactionType.debit
        elif cv:
            amount, type_ = cv, TransactionType.credit
        else:
            return None
    else:
        amt_idx = cols.get("amount")
        candidates = []
        if amt_idx is not None and amt_idx < len(cleaned):
            candidates.append((amt_idx, cleaned[amt_idx]))
        # any other numeric cell (excluding balance & date) is a candidate
        for i, c in enumerate(cleaned):
            if i == date_idx or i == cols.get("balance"):
                continue
            if c and _parse_amount(c) is not None:
                candidates.append((i, c))
        if not candidates:
            return None
        amt_idx, amt_str = candidates[0]
        amount = _parse_amount(amt_str)
        if amount is None:
            return None
        # type from Dr/Cr marker if present
        type_ = TransactionType.debit
        for c in cleaned:
            cc = c.lower()
            if re.search(r"\bcr\b|credit", cc):
                type_ = TransactionType.credit
            elif re.search(r"\bdr\b|debit", cc):
                type_ = TransactionType.debit

    # --- description ---
    desc_parts: list[str] = []
    remarks: str | None = None
    upi: str | None = None
    ref: str | None = None
    skip_idx = {date_idx, amt_idx, debit_idx, credit_idx, cols.get("balance")}
    skip_idx.discard(None)
    for i, c in enumerate(cleaned):
        if not c:
            continue
        if i == cols.get("remarks") and cols.get("remarks") is not None:
            remarks = c
            continue
        if i == cols.get("upi") or _is_upi(c):
            upi = _is_upi(c) or upi
            continue
        if i == cols.get("ref") or (REF_RE.match(c) and len(c) >= 8):
            ref = c
            continue
        if i in skip_idx:
            continue
        desc_parts.append(c)
    description = " ".join(desc_parts).strip() or (remarks or "")
    if not description and upi:
        description = f"UPI payment to {upi}"

    # type fallback by description text
    if type_ is None:
        low = description.lower()
        if "credit" in low or "refund" in low or "received" in low:
            type_ = TransactionType.credit
        else:
            type_ = TransactionType.debit

    return ParsedRow(
        date=d,
        description=description,
        remarks=remarks,
        amount=round(amount, 2),
        type=type_,
        counterparty_upi=upi,
        upi_ref=ref,
    )


def parse_pdf(file_path: str, other_member_ids: list) -> ParseResult:
    """Parse a statement PDF into transactions. `other_member_ids` is used for
    the shared-with hint; classification is done here so the preview is ready
    to review."""
    result = ParseResult()
    pdf = pdfplumber.open(file_path)
    try:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if result.account_name is None or result.account_upi is None:
                _extract_header(text, result)

            tables = []
            try:
                tables = page.extract_tables({"vertical_strategy": "lines"})
            except Exception:
                tables = []
            if not tables:
                try:
                    tables = page.extract_tables()
                except Exception:
                    tables = []

            if tables:
                for table in tables:
                    if not table:
                        continue
                    header_row = [c or "" for c in table[0]]
                    cols = _detect_columns(header_row)
                    if "date" not in cols:
                        # maybe header is on row 1
                        if len(table) > 1:
                            cols = _detect_columns([c or "" for c in table[1]])
                            start = 2 if "date" in cols else 1
                        else:
                            start = 1
                    else:
                        start = 1
                    if "date" not in cols:
                        # no recognisable columns; try every row heuristically
                        for row in table[start:]:
                            parsed = _row_to_parsed([c or "" for c in row], {})
                            if parsed:
                                result.rows.append(parsed)
                        continue
                    for row in table[start:]:
                        if not row:
                            continue
                        cells = [c or "" for c in row]
                        parsed = _row_to_parsed(cells, cols)
                        if parsed:
                            result.rows.append(parsed)
            else:
                # fallback: parse text lines
                result.warnings.append(
                    "No table structure detected on some pages; parsed rows from text."
                )
                for line in text.splitlines():
                    if _parse_date(line):
                        cells = line.split()
                        parsed = _row_to_parsed(cells, {})
                        if parsed:
                            result.rows.append(parsed)
    finally:
        pdf.close()

    # sort + drop duplicates
    seen = set()
    unique: list[ParsedRow] = []
    for r in sorted(result.rows, key=lambda r: (r.date, r.amount)):
        key = (r.date, r.amount, r.description, r.type)
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)
    result.rows = unique

    if not result.rows:
        result.warnings.append("No transactions could be parsed from this PDF.")
    return result
