from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.routes import health, members, transactions, upload, views

app = FastAPI(title="fin-fy", description="Self-hosted shared monthly ledger")

app.include_router(health.router, prefix="/api")
app.include_router(members.router, prefix="/api")
app.include_router(transactions.router, prefix="/api")
app.include_router(upload.router, prefix="/api")
app.include_router(views.router, prefix="/api")

STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
