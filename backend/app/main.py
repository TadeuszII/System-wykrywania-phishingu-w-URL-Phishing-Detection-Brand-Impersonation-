from fastapi import FastAPI

app = FastAPI(
    title="Guardy Backend",
    description="Backend API for Guardy phishing URL detection.",
    version="0.1.0",
)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
