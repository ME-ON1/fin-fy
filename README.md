# fin-fy 💸

Self-hosted shared monthly ledger. Upload your bank/UPI statement PDFs from
your phone browser, review the parsed rows, and save them. Track what you paid
to each UPI ID month-wise, and see a month-wise ledger with "shared" (both)
transactions split between people.

## Features

- **PDF upload on mobile** — big upload button, statements are parsed and shown
  in a review screen before anything is saved.
- **Person namespace per device** — first upload asks for your name; your
  phone model is detected from the browser's user-agent (e.g. *Galaxy S24*,
  *iPhone*) and bound to your member record. Uploads from the same device are
  always tagged to you.
- **"both" sharing logic** — remarks containing *both* (or groceries, which is
  always shared) are flagged as shared and split 50/50 with the other person.
  Categories (food, transport, groceries…) are auto-guessed.
- **Views**
  - *Ledger* — month-wise ledger with spent/received/shared totals, category
    breakdown, and per-day grouping.
  - *By UPI* — what you paid to each UPI ID (VPA) in a month, with counts,
    totals and shared amounts.
  - *People* — who paid what, and who owes whom the shared half.
- **Self-hosted** — runs on your LAN; any phone on the network can use it.

## Stack

FastAPI · SQLAlchemy · Alembic · PostgreSQL (Docker) · pdfplumber · vanilla JS

## Setup

```bash
# 1. install deps
uv sync

# 2. start the database (port 5544, so it doesn't clash with other postgres)
docker compose up -d

# 3. migrate
.venv/bin/alembic upgrade head

# 4. run (binds all interfaces for LAN access)
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open `http://<your-machine-ip>:8000` from your phone browser (find the IP with
`ipconfig getifaddr en0` on macOS or `hostname -I` on Linux). Register your
name once — it is bound to your phone — then upload a statement PDF.

> The DB listens on port **5544** (`.env` → `DB_PORT`). Change it in
> `docker-compose.yaml` and `.env` if you prefer another port.

## Generating a sample statement (for testing)

```bash
.venv/bin/python scripts/make_sample_pdf.py /tmp/sample_statement.pdf
```

Then upload `/tmp/sample_statement.pdf` from the UI.

## Statement formats supported

The parser auto-detects the common Indian UPI/bank layouts:

- UPI statements with a `UPI ID` column (PhonePe / GPay / Paytm style)
- Bank statements with separate *Withdrawal* / *Deposit* columns + balance
- Single amount column + `Dr`/`Cr` marker

Everything it gets wrong (and a few rows without column lines will carry the
balance into the description) can be fixed in the review screen before saving.

## How the "both" logic works (current)

- `both` in remarks/description → shared (`is_shared = true`)
- category groceries (Dmart, Blinkit, BigBasket, …) → always shared
- shared = 50/50 split with `shared_with` (auto-set to the other member when
  exactly two people exist; editable in the review screen)
- *People* view shows the running settlement: payer's shared half is owed back
  by the other person.

## API overview

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/members/register` | register device → member (binds phone model) |
| GET | `/api/members/me?device_id=` | resolve member for this device |
| POST | `/api/upload` | upload PDF → parsed preview (multipart, `X-Device-Id` header) |
| POST | `/api/transactions/batch?member_id=` | save reviewed rows |
| GET | `/api/views/ledger?month=YYYY-MM` | month-wise ledger + totals |
| GET | `/api/views/upi-summary?month=YYYY-MM` | paid-to-UPI-ID month-wise |
| GET | `/api/views/members-summary` | who paid / owes whom |

## Roadmap

- [ ] Settlement report (exact "who pays whom" for the shared split)
- [ ] More statement templates / drag-drop reorder of parse columns
- [ ] Category rules editor
- [ ] Export CSV
