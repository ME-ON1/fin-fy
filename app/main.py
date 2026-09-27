from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from app.routes import health, members, transactions, upload, views

app = FastAPI(title="fin-fy", description="Self-hosted shared monthly ledger")

app.include_router(health.router, prefix="/api")
app.include_router(members.router, prefix="/api")
app.include_router(transactions.router, prefix="/api")
app.include_router(upload.router, prefix="/api")
app.include_router(views.router, prefix="/api")


@app.middleware("http")
async def no_stale_cache(request: Request, call_next):
    """Never serve a stale index.html; revalidate app assets so UI updates
    (like a new tab) actually reach phones instead of browser caches."""
    response = await call_next(request)
    path = request.url.path
    if path in ("/", "/index.html"):
        response.headers["Cache-Control"] = "no-store"
    elif path.endswith((".js", ".css")):
        response.headers["Cache-Control"] = "no-cache"
    return response


STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
