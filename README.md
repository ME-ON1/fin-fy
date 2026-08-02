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
- **Device fingerprinting** — each device is fingerprinted (canvas + WebGL +
  UA + locale/timezone hashed with SHA-256) and bound to your member. API
  access requires a matching fingerprint, so only your device can act as you —
  even if browser storage is cleared, the device is still recognized. A PIN
  (set at registration) is required to bind a *new* device to an existing
  member, and the wrong PIN is rejected.
- **Scan & pay (UPI QR → Google Pay)** — the *Pay* tab opens your camera to
  scan a UPI QR, pre-fills the merchant and amount, and deep-links into
  Google Pay (`tez://upi/pay`). One-tap note presets (*Uber both / solo*,
  *Swiggy both / solo*, *groceries*, …) become the transaction remark, so
  "both" entries auto-flag as shared. On return you mark the outcome
  **Success / Failed / No status** — only *Success* counts in the totals;
  *No status* keeps the entry in the ledger as **pending** (excluded from
  calculations, confirmable later from the list); *Failed* saves nothing.
  (Camera capture works on plain HTTP; a live viewfinder would need HTTPS.)
- **"both" sharing logic** — remarks containing *both* (or groceries, which is
  always shared) are flagged as shared and split 50/50 with the other person.
  Categories (food, transport, groceries…) are auto-guessed.
- **Views**
  - *Ledger* — month-wise ledger with spent/received/shared totals, category
    breakdown, and per-day grouping.
  - *By UPI* — what you paid to each UPI ID (VPA) in a month, with counts,
    totals and shared amounts.
  - *Split* — month-wise split of every shared transaction plus the net
    settlement (who pays whom).
  - *People* — who paid what, and who owes whom the shared half.
- **Self-hosted** — runs on your LAN; any phone on the network can use it.

## Stack

FastAPI · SQLAlchemy · Alembic · vanilla JS · pdfplumber

**Database is pluggable** — pick one via `DB_TYPE` in `.env`:

| `DB_TYPE` | Where data lives | Notes |
| --- | --- | --- |
| `libsql` (default) | **self-hosted sqld** — the open-source libSQL server in Docker (`docker compose up -d`) | recommended: real DB server on your machine |
| `sqlite` | a single file `data/fin_fy.db` | zero-Docker fallback |
| `postgres` | Docker `fin-fy-db` on port 5544 | if you prefer Postgres |
| `libsql` + Turso cloud | Turso's servers | change `TURSO_URL` to `libsql://<org>.turso.io` + token |

## Setup

```bash
# 1. install deps
uv sync

# 2. start the database server (self-hosted libSQL/sqld, binds to 127.0.0.1 only)
docker compose up -d

# 3. create/migrate the database (respects DB_TYPE)
.venv/bin/alembic upgrade head

# 4. run (binds all interfaces for LAN access)
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open `http://<your-machine-ip>:8000` from your phone browser (find the IP with
`ipconfig getifaddr en0` on macOS or `hostname -I` on Linux). Register your
name once — it is bound to your phone — then upload a statement PDF.

### SQLite (no Docker)

```bash
# .env: DB_TYPE=sqlite
docker compose down   # sqld not needed
.venv/bin/alembic upgrade head
```

### Postgres (optional)

```bash
# .env: DB_TYPE=postgres (and DB_USER/DB_PASS/DB_PORT/DB_NAME)
docker compose up -d
.venv/bin/alembic upgrade head
```

### Turso cloud (optional, data leaves your machine)

```bash
turso auth login && turso db create finfy && turso db tokens create finfy
```

```
# .env
DB_TYPE=libsql
TURSO_URL=libsql://finfy-<org>.turso.io
TURSO_AUTH_TOKEN=<token>
```

> **Why a custom dialect instead of `sqlalchemy-libsql`/`pyturso`?** Modern sqld
> (0.24+) serves Hrana over HTTP/WebSocket; the embedded-replica sync protocol
> moved to gRPC, which the Python drivers don't support yet (and `pyturso`'s
> sync mode needs a local replica file + explicit pull/push anyway). The app
> therefore talks to sqld **directly** (`app/libsql_dialect.py` — Hrana
> over `ws://`), same as it would to Postgres: no local replica to manage.
> `pyturso` stays in the deps for the local-replica path if you ever want it.

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
