"""Classification logic for parsed transactions.

- Category is guessed from description/remarks keywords.
- is_shared is True when remarks/description contain "both" (means another
  person is involved) or when the category is groceries (always shared).
"""

import re
import uuid

from app.models import Category, TransactionType

_BOTH_RE = re.compile(r"\bboth\b", re.IGNORECASE)

# "UPI/DR/8245/12873/Swiggy" -> "Swiggy"; strip UPI ref prefixes
_UPI_DESC_PREFIX_RE = re.compile(
    r"^(upi[/\\-]?)?(dr|cr)[/\\-]?\d+[/\\-]?\d+[/\\-]?", re.IGNORECASE
)
_REF_PREFIX_RE = re.compile(r"^(txn|ref|upi)\d{4,}", re.IGNORECASE)


def guess_counterparty(description: str, counterparty_upi: str | None) -> str | None:
    """Best-effort merchant name from the description, for grouping when the
    statement has no UPI/VPA column."""
    if counterparty_upi:
        return counterparty_upi.split("@")[0].replace("_", " ").title()
    desc = description.strip()
    desc = _UPI_DESC_PREFIX_RE.sub("", desc).strip()
    desc = _REF_PREFIX_RE.sub("", desc).strip()
    if not desc:
        return None
    return desc[:80]


_CATEGORY_KEYWORDS: dict[Category, list[str]] = {
    Category.groceries: [
        "grocer", "supermarket", "bigbasket", "blinkit", "dmart", "zepto",
        "instamart", "kirana", "sabji", "sabzi", "bazaar", "bazar", "metro",
        "more super", "reliance fresh", "fresh", "mart",
    ],
    Category.transport: [
        "cab", "uber", "ola", "rapido", "taxi", "auto", "metrorail", "metro",
        "fuel", "petrol", "diesel", "indian oil", "iocl", "hpcl", "bpcl",
        "bus", "train", "irctc", "redbus", "parking", "toll", "fastag",
        "bike", "scooty", "car wash", "ev charging",
    ],
    Category.food: [
        "swiggy", "zomato", "food", "restaurant", "cafe", "dominos", "domino",
        "mcdonald", "kfc", "pizza", "biriyani", "biryani", "tea", "coffee",
        "dosa", "hotel", "eatery", "ice cream", "bakery", "chai",
    ],
    Category.shopping: [
        "amazon", "flipkart", "myntra", "meesho", "shopping", "mall", "store",
        "shop", "clothing", "fashion", "ajio", "snapdeal", "lifestyle",
    ],
    Category.utilities: [
        "electric", "electricity", "bill", "water", "gas", "internet", "jio",
        "airtel", "vi ", "recharge", "wifi", "broadband", "lpg", "indane",
        "cable", "dth",
    ],
    Category.health: [
        "pharmacy", "medical", "medicin", "hospital", "clinic", "doctor",
        "apollo", "netmeds", "pharmeasy", "1mg", "lab test", "chemist",
    ],
    Category.entertainment: [
        "netflix", "amazon prime", "prime video", "hotstar", "disney", "spotify",
        "youtube", "gaana", "bookmyshow", "movie", "theatre", "theater", "game",
        "play store", "app store", "steam", "psn",
    ],
    Category.transfer: [
        "transfer", "self", "own account", "to self", "peer", "p2p", "upi ref",
    ],
}

# Order matters: check longest/rarest first is unnecessary; simple contains is fine.
def guess_category(description: str, remarks: str | None, type_: TransactionType) -> Category:
    text = f"{description} {remarks or ''}".lower()
    for cat, keywords in _CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in text:
                return cat
    if type_ == TransactionType.credit:
        return Category.income
    return Category.other


def is_shared_transaction(description: str, remarks: str | None, category: Category) -> bool:
    text = f"{description} {remarks or ''}"
    if _BOTH_RE.search(text):
        return True
    if category == Category.groceries:
        return True
    return False


def pick_shared_with(
    other_member_ids: list[uuid.UUID],
    description: str,
    remarks: str | None,
) -> uuid.UUID | None:
    """Best guess of who the 'other person' is. If exactly one other member
    exists, that's them. Otherwise, if the remark names someone, try a match."""
    text = f"{description} {remarks or ''}".lower()
    if len(other_member_ids) == 1:
        return other_member_ids[0]
    return None


def classify(
    description: str,
    remarks: str | None,
    type_: TransactionType,
    other_member_ids: list[uuid.UUID],
) -> tuple[Category, bool, uuid.UUID | None]:
    """Returns (category, is_shared, shared_with_id)."""
    category = guess_category(description, remarks, type_)
    is_shared = is_shared_transaction(description, remarks, category)
    shared_with = pick_shared_with(other_member_ids, description, remarks) if is_shared else None
    return category, is_shared, shared_with
