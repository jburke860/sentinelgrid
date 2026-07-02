"""Backtest harness: replay telemetry through the scoring models and report
precision/recall/F1 against labeled anomaly windows.

Input readings come from an NDJSON file (full MQTT-contract payloads or flat
{device_id, timestamp, <metrics>} rows) or from the database. Labels are a
JSON list of {"device_id": ..., "start": iso, "end": iso} anomaly windows.

Usage:
    python -m app.backtest --input data/sample_readings.ndjson \
        --labels data/sample_labels.json
    python -m app.backtest --from-db --since-hours 24 --labels labels.json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from typing import Any

from .scoring import BASELINES, score_reading

try:
    from . import iforest
except ImportError:  # pragma: no cover
    iforest = None

LEVEL_ORDER = ("normal", "watch", "warning", "critical")


def _parse_ts(value: str) -> datetime:
    ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return ts if ts.tzinfo else ts.replace(tzinfo=UTC)


def load_ndjson(path: str) -> list[dict[str, Any]]:
    """Normalize NDJSON lines to {device_id, timestamp, values}."""
    readings = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            values = row.get("readings") or {m: row.get(m) for m in BASELINES}
            readings.append(
                {
                    "device_id": row["device_id"],
                    "timestamp": _parse_ts(row["timestamp"]),
                    "values": values,
                }
            )
    return readings


def load_from_db(since_hours: float) -> list[dict[str, Any]]:
    from psycopg.rows import dict_row

    from . import db

    conn = db.connect_with_retry()
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            select device_id, observed_at as timestamp,
                   temperature_c, humidity_pct, pm25_ugm3,
                   smoke_ppm, water_level_m, wind_speed_mps
            from telemetry_readings
            where observed_at > now() - make_interval(hours => %s)
            order by observed_at
            """,
            (since_hours,),
        )
        rows = cur.fetchall()
    conn.close()
    return [
        {
            "device_id": r["device_id"],
            "timestamp": r["timestamp"],
            "values": {m: r[m] for m in BASELINES},
        }
        for r in rows
    ]


def load_labels(path: str) -> list[dict[str, Any]]:
    with open(path, encoding="utf-8") as fh:
        windows = json.load(fh)
    return [
        {
            "device_id": w["device_id"],
            "start": _parse_ts(w["start"]),
            "end": _parse_ts(w["end"]),
        }
        for w in windows
    ]


def _labeled_anomalous(reading: dict[str, Any], labels: list[dict[str, Any]]) -> bool:
    return any(
        w["device_id"] == reading["device_id"]
        and w["start"] <= reading["timestamp"] <= w["end"]
        for w in labels
    )


def _predict(reading: dict[str, Any], model: str, threshold: str) -> bool:
    if model == "iforest":
        if iforest is None:
            raise SystemExit("scikit-learn is required for --model iforest")
        return bool(iforest.score_reading(reading["values"])["anomalous"])
    result = score_reading(reading["values"])
    return LEVEL_ORDER.index(result["risk_level"]) >= LEVEL_ORDER.index(threshold)


def evaluate(
    readings: list[dict[str, Any]],
    labels: list[dict[str, Any]],
    model: str = "zscore",
    threshold: str = "warning",
) -> dict[str, Any]:
    tp = fp = fn = tn = 0
    for reading in readings:
        predicted = _predict(reading, model, threshold)
        actual = _labeled_anomalous(reading, labels)
        if predicted and actual:
            tp += 1
        elif predicted:
            fp += 1
        elif actual:
            fn += 1
        else:
            tn += 1
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "model": model,
        "threshold": threshold,
        "readings": len(readings),
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input", help="NDJSON file of telemetry readings")
    source.add_argument("--from-db", action="store_true", help="replay from PostgreSQL")
    parser.add_argument("--labels", required=True, help="JSON file of anomaly windows")
    parser.add_argument("--since-hours", type=float, default=24.0)
    parser.add_argument("--model", choices=["zscore", "iforest", "both"], default="both")
    parser.add_argument("--threshold", choices=["watch", "warning", "critical"], default="warning")
    args = parser.parse_args(argv)

    readings = load_from_db(args.since_hours) if args.from_db else load_ndjson(args.input)
    labels = load_labels(args.labels)
    models = ["zscore", "iforest"] if args.model == "both" else [args.model]
    if "iforest" in models and iforest is None:
        models.remove("iforest")
        print("note: scikit-learn unavailable; skipping iforest", file=sys.stderr)
    reports = [evaluate(readings, labels, model=m, threshold=args.threshold) for m in models]
    print(json.dumps(reports, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
