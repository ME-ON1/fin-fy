"""Generate a sample UPI statement PDF to test the fin-fy upload pipeline.

Usage:  .venv/bin/python scripts/make_sample_pdf.py [output.pdf]
"""

import random
import sys
from datetime import date, timedelta

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sample_statement.pdf"

STYLE = ParagraphStyle("cell", fontSize=7.5, leading=9.5)

# (date offset, description, remarks, amount, type, upi_id)
TXN = [
    (0, "UPI/DR/8245/12873/Swiggy", "food both", 342.50, "dr", "swiggy@ybl"),
    (1, "UPI/DR/8245/12890/Uber India", "cab both", 187.00, "dr", "uber@ybl"),
    (1, "UPI/CR/0001/9001/Salary Credit", "", 45000.00, "cr", "self@okhdfcbank"),
    (2, "UPI/DR/8245/12904/Dmart", "groceries", 1245.75, "dr", "dmart@paytm"),
    (3, "UPI/DR/8245/12931/Netflix", "both", 649.00, "dr", "netflix@ybl"),
    (4, "UPI/DR/8245/12952/Blinkit", "groceries", 458.20, "dr", "blinkit@ybl"),
    (5, "UPI/DR/8245/12988/Indian Oil Petrol", "solo", 1200.00, "dr", "ioc@okaxis"),
    (6, "UPI/DR/8245/13002/Zomato", "food both", 560.00, "dr", "zomato@ybl"),
    (7, "UPI/DR/8245/13015/Airtel Postpaid", "", 799.00, "dr", "airtel@ybl"),
    (8, "UPI/DR/8245/13040/Amazon Pay", "both", 2100.00, "dr", "amazon@ybl"),
]

MONTH = date.today().replace(day=1)


def main() -> None:
    doc = SimpleDocTemplate(
        OUT, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
        topMargin=16 * mm, bottomMargin=16 * mm,
    )
    story = [
        Paragraph("<b>Paytm Payments Bank</b> — UPI Statement", ParagraphStyle(
            "h", fontSize=13, leading=16, spaceAfter=2)),
        Paragraph(f"Your UPI ID: <b>rohan@paytm</b>", ParagraphStyle("s", fontSize=9, leading=12)),
        Paragraph(f"From {MONTH:%d/%m/%Y} To {(MONTH.replace(month=MONTH.month % 12 + 1) - timedelta(days=1)) if MONTH.month < 12 else date(MONTH.year+1,1,1)-timedelta(days=1):%d/%m/%Y}",
                  ParagraphStyle("s2", fontSize=9, leading=12, textColor=colors.grey)),
        Spacer(1, 6 * mm),
    ]

    header = ["Date", "UPI Ref No", "Description", "Remarks", "Amount (₹)", "UPI ID"]
    rows = [header]
    balance = 10000.0
    for offset, desc, remarks, amt, kind, upi in TXN:
        d = MONTH + timedelta(days=offset)
        ref = f"UPI{random.randint(1000000000, 9999999999)}"
        balance = balance - amt if kind == "dr" else balance + amt
        rows.append([
            Paragraph(f"{d:%d/%m/%Y}", STYLE),
            Paragraph(ref, STYLE),
            Paragraph(desc, STYLE),
            Paragraph(remarks, STYLE),
            Paragraph(f"{amt:,.2f}", STYLE),
            Paragraph(upi, STYLE),
        ])

    table = Table(rows, colWidths=[19 * mm, 26 * mm, 62 * mm, 20 * mm, 20 * mm, 28 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef2f7")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c9d2dc")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(table)
    doc.build(story)
    print(f"Wrote {OUT} with {len(TXN)} transactions")


if __name__ == "__main__":
    main()
