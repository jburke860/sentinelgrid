"""Environment-driven configuration for the SentinelGrid API."""
from __future__ import annotations

import os

DEFAULT_DATABASE_URL = "postgresql://sentinelgrid:sentinelgrid@localhost:5432/sentinelgrid"


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    # Tolerate SQLAlchemy-style URLs (postgresql+psycopg://...) in .env files.
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def mqtt_host() -> str:
    return os.environ.get("MQTT_HOST", "localhost")


def mqtt_port() -> int:
    return int(os.environ.get("MQTT_PORT", "1883"))


def mqtt_enabled() -> bool:
    return os.environ.get("MQTT_INGEST_ENABLED", "1") not in ("0", "false", "no")
