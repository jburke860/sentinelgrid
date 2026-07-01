"""Worker database helpers."""
from __future__ import annotations

import logging
import os
import time

import psycopg

log = logging.getLogger("sentinelgrid.worker.db")

DEFAULT_DATABASE_URL = "postgresql://sentinelgrid:sentinelgrid@localhost:5432/sentinelgrid"


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def connect_with_retry() -> psycopg.Connection:
    delay = 1.0
    while True:
        try:
            conn = psycopg.connect(database_url(), autocommit=False)
            log.info("connected to database")
            return conn
        except psycopg.OperationalError as exc:
            log.warning("database not ready (%s); retrying in %.0fs", exc, delay)
            time.sleep(delay)
            delay = min(delay * 2, 30.0)
