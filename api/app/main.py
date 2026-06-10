from fastapi import FastAPI

app = FastAPI(
    title="SentinelGrid API",
    version="0.1.0",
    description="Local-first API for edge telemetry ingestion and climate-risk monitoring.",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

