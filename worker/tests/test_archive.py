"""Archive blob builder tests (pure part of the MinIO archival job)."""
from __future__ import annotations

import gzip
import hashlib
import json

from app.archive import build_archive_blob

PAYLOADS = [
    {"device_id": "edge-ca-001", "sequence": 1, "readings": {"temperature_c": 30.1}},
    {"device_id": "edge-ca-002", "sequence": 2, "readings": {"temperature_c": 29.7}},
]


def test_blob_roundtrips_as_ndjson():
    blob, _checksum, count = build_archive_blob(PAYLOADS)
    lines = gzip.decompress(blob).decode("utf-8").strip().split("\n")
    assert count == 2
    assert len(lines) == 2
    assert json.loads(lines[0])["device_id"] == "edge-ca-001"
    assert json.loads(lines[1])["sequence"] == 2


def test_checksum_matches_blob():
    blob, checksum, _count = build_archive_blob(PAYLOADS)
    assert checksum == hashlib.sha256(blob).hexdigest()


def test_blob_is_reproducible():
    # gzip mtime is pinned, so identical input -> identical bytes/checksum.
    assert build_archive_blob(PAYLOADS) == build_archive_blob(PAYLOADS)


def test_key_order_does_not_change_checksum():
    reordered = [dict(reversed(list(p.items()))) for p in PAYLOADS]
    assert build_archive_blob(PAYLOADS)[1] == build_archive_blob(reordered)[1]
