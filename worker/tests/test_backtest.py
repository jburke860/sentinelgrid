"""Backtest harness tests using the checked-in sample data (no DB)."""
from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from app.backtest import evaluate, load_labels, load_ndjson

DATA = Path(__file__).resolve().parent.parent / "data"


def ts(minute: int) -> datetime:
    return datetime(2026, 7, 1, minute // 60, minute % 60, tzinfo=UTC)


def test_load_sample_ndjson():
    readings = load_ndjson(str(DATA / "sample_readings.ndjson"))
    assert len(readings) == 30
    assert readings[0]["device_id"] == "edge-ca-001"
    assert set(readings[0]["values"]) >= {"temperature_c", "smoke_ppm"}
    assert readings[0]["timestamp"].tzinfo is not None


def test_zscore_backtest_on_sample_is_clean():
    readings = load_ndjson(str(DATA / "sample_readings.ndjson"))
    labels = load_labels(str(DATA / "sample_labels.json"))
    report = evaluate(readings, labels, model="zscore", threshold="warning")
    assert report["tp"] == 10
    assert report["fp"] == 0
    assert report["fn"] == 0
    assert report["precision"] == 1.0
    assert report["recall"] == 1.0
    assert report["f1"] == 1.0


def test_synthetic_partial_detection():
    normal = {"temperature_c": 30.0, "humidity_pct": 28.0, "pm25_ugm3": 16.0,
              "smoke_ppm": 2.0, "water_level_m": 1.2, "wind_speed_mps": 4.5}
    hot = {**normal, "smoke_ppm": 8.0, "pm25_ugm3": 45.0}
    readings = (
        [{"device_id": "d1", "timestamp": ts(i), "values": normal} for i in range(5)]
        # labeled anomalous but signal-free: should be a false negative
        + [{"device_id": "d1", "timestamp": ts(10), "values": normal}]
        + [{"device_id": "d1", "timestamp": ts(11 + i), "values": hot} for i in range(4)]
    )
    labels = [{"device_id": "d1", "start": ts(10), "end": ts(14)}]
    report = evaluate(readings, labels, model="zscore", threshold="warning")
    assert report["tp"] == 4
    assert report["fn"] == 1
    assert report["fp"] == 0
    assert report["recall"] == 0.8
    assert report["precision"] == 1.0


def test_no_predictions_yields_zero_metrics():
    normal = {"temperature_c": 30.0, "humidity_pct": 28.0, "pm25_ugm3": 16.0,
              "smoke_ppm": 2.0, "water_level_m": 1.2, "wind_speed_mps": 4.5}
    readings = [{"device_id": "d1", "timestamp": ts(0), "values": normal}]
    report = evaluate(readings, [], model="zscore")
    assert report["tp"] == report["fp"] == report["fn"] == 0
    assert report["tn"] == 1
    assert report["precision"] == report["recall"] == report["f1"] == 0.0
