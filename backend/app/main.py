from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI

from app.database import check_database, init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(
    title="Guardy Backend",
    description="Backend API for Guardy phishing URL detection.",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
def health_check() -> dict[str, Any]:
    return {
        "status": "ok",
        "database": "ok" if check_database() else "error",
    }
