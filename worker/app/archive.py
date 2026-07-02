"""Raw telemetry archival to MinIO.

Batches unarchived readings into gzipped NDJSON objects, uploads them, and
records each batch in raw_archives with a sha256 checksum. The high-water
mark lives in raw_archives.metadata->>'max_id', so batches never overlap.
Safe no-op when MinIO is unreachable or the batch is too small.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import logging
import os
from datetime import UTC, datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

log = logging.getLogger("sentinelgrid.worker.archive")

SOURCE_NAME = "telemetry-ndjson"
MIN_BATCH = 100
MAX_BATCH = 5000


def minio_config() -> dict[str, str]:
    return {
        "endpoint": os.environ.get("MINIO_ENDPOINT", "http://localhost:9000"),
        "access_key": os.environ.get("MINIO_ACCESS_KEY", "sentinelgrid"),
        "secret_key": os.environ.get("MINIO_SECRET_KEY", "sentinelgrid123"),
        "bucket": os.environ.get("MINIO_BUCKET", "sentinelgrid-raw"),
    }


def build_archive_blob(payloads: list[dict[str, Any]]) -> tuple[bytes, str, int]:
    """Gzip payload dicts as NDJSON; return (bytes, sha256 hex, record count)."""
    ndjson = "\n".join(json.dumps(p, sort_keys=True, default=str) for p in payloads) + "\n"
    # mtime=0 keeps the gzip output (and therefore the checksum) reproducible.
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        gz.write(ndjson.encode("utf-8"))
    blob = buf.getvalue()
    return blob, hashlib.sha256(blob).hexdigest(), len(payloads)


def _client(cfg: dict[str, str]):
    from minio import Minio

    endpoint = cfg["endpoint"]
    secure = endpoint.startswith("https://")
    host = endpoint.split("://", 1)[-1]
    return Minio(host, access_key=cfg["access_key"], secret_key=cfg["secret_key"], secure=secure)


def archive_new_readings(conn: psycopg.Connection) -> int:
    """Archive readings past the high-water mark. Returns records archived."""
    cfg = minio_config()
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            select coalesce(max((metadata->>'max_id')::bigint), 0) as high_water
            from raw_archives where source_name = %s
            """,
            (SOURCE_NAME,),
        )
        high_water = cur.fetchone()["high_water"]
        cur.execute(
            """
            select id, observed_at, raw_payload
            from telemetry_readings
            where id > %s
            order by id
            limit %s
            """,
            (high_water, MAX_BATCH),
        )
        rows = cur.fetchall()
    if len(rows) < MIN_BATCH:
        conn.rollback()
        return 0

    blob, checksum, count = build_archive_blob([r["raw_payload"] for r in rows])
    min_id, max_id = rows[0]["id"], rows[-1]["id"]
    started_at = rows[0]["observed_at"]
    finished_at = rows[-1]["observed_at"]
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    key = f"telemetry/{stamp}-{min_id}-{max_id}.ndjson.gz"

    try:
        client = _client(cfg)
        if not client.bucket_exists(cfg["bucket"]):
            client.make_bucket(cfg["bucket"])
        client.put_object(
            cfg["bucket"], key, io.BytesIO(blob), length=len(blob),
            content_type="application/gzip",
        )
    except Exception as exc:  # noqa: BLE001 - MinIO down must not break the worker
        log.warning("minio archive skipped (%s)", exc)
        conn.rollback()
        return 0

    with conn.cursor() as cur:
        cur.execute(
            """
            insert into raw_archives (
              source_name, object_uri, started_at, finished_at,
              record_count, checksum, metadata
            ) values (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                SOURCE_NAME,
                f"s3://{cfg['bucket']}/{key}",
                started_at,
                finished_at,
                count,
                checksum,
                Jsonb({"min_id": min_id, "max_id": max_id}),
            ),
        )
    conn.commit()
    log.info("archived %d readings to %s", count, key)
    return count
