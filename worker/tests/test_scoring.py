"""Unit tests for the z-score baseline scoring engine (pure, no DB)."""
from __future__ import annotations

import pytest

from app.scoring import (
    BASELINES,
    MODEL_NAME,
    MODEL_VERSION,
    compute_zscores,
    hazard_scores,
    risk_level,
    score_reading,
)

BASELINE_VALUES = {metric: mean for metric, (mean, _std) in BASELINES.items()}


def test_model_identity():
    assert MODEL_NAME == "zscore-baseline"
    assert MODEL_VERSION == "0.1"


def test_baseline_reading_is_normal():
    result = score_reading(BASELINE_VALUES)
    assert result["risk_score"] == 0
    assert result["risk_level"] == "normal"
    assert all(z == 0.0 for z in result["features"].values())


def test_zscores_match_baselines():
    z = compute_zscores({**BASELINE_VALUES, "temperature_c": 37.0})
    assert z["temperature_c"] == pytest.approx((37.0 - 30.0) / 3.5)
    assert z["humidity_pct"] == 0.0


def test_missing_metrics_score_zero():
    result = score_reading({"temperature_c": 30.0})
    assert result["risk_score"] == 0
    assert result["risk_level"] == "normal"


def test_wildfire_signature_ranks_wildfire_top():
    values = {
        **BASELINE_VALUES,
        "smoke_ppm": 7.1,       # z = 5.1
        "pm25_ugm3": 22.0,      # z = 1.0
        "temperature_c": 37.0,  # z = 2.0
        "humidity_pct": 12.0,   # z = -2.0 -> dryness 2.0
    }
    result = score_reading(values)
    assert result["hazard"] == "wildfire"
    # wildfire = 0.5*5.1 + 0.3*1.0 + 0.2*2.0 + 0.1*2.0 = 3.45 -> round(55.2) = 55
    # (beats air_quality = 0.6*1.0 + 0.4*5.1 = 2.64 and heat = 2.0)
    assert result["risk_score"] == 55
    assert result["risk_level"] == "warning"
    assert result["explanation"]["hazard"] == "wildfire"
    assert result["explanation"]["top"][0]["hazard"] == "wildfire"
    assert len(result["explanation"]["top"]) == 3


def test_flood_signature():
    values = {**BASELINE_VALUES, "water_level_m": 2.4, "wind_speed_mps": 7.0}
    z_water = (2.4 - 1.2) / 0.15  # 8.0
    z_wind = (7.0 - 4.5) / 1.2
    expected = 0.75 * z_water + 0.25 * z_wind
    result = score_reading(values)
    assert result["hazard"] == "flood"
    assert result["risk_score"] == min(100, round(expected * 16))
    assert result["risk_level"] == "critical"


def test_winter_storm_uses_cold_direction():
    values = {**BASELINE_VALUES, "temperature_c": 12.0, "wind_speed_mps": 9.0}
    z = compute_zscores(values)
    hazards = hazard_scores(z)
    assert hazards["winter_storm"] == pytest.approx(
        0.6 * ((30.0 - 12.0) / 3.5) + 0.4 * ((9.0 - 4.5) / 1.2)
    )
    # heat gets no contribution from cold temperature
    assert hazards["heat"] == 0.0


def test_negative_z_never_contributes():
    values = {
        **BASELINE_VALUES,
        "smoke_ppm": 0.0,
        "pm25_ugm3": 0.0,
        "wind_speed_mps": 0.0,
        "water_level_m": 0.5,
    }
    hazards = hazard_scores(compute_zscores(values))
    assert hazards["air_quality"] == 0.0
    assert hazards["flood"] == 0.0


def test_score_is_clamped_to_100():
    values = {**BASELINE_VALUES, "water_level_m": 10.0}
    result = score_reading(values)
    assert result["risk_score"] == 100
    assert result["risk_level"] == "critical"


@pytest.mark.parametrize(
    ("score", "level"),
    [
        (0, "normal"), (24, "normal"),
        (25, "watch"), (49, "watch"),
        (50, "warning"), (74, "warning"),
        (75, "critical"), (100, "critical"),
    ],
)
def test_risk_level_thresholds(score, level):
    assert risk_level(score) == level


def test_features_are_zscores_json_ready():
    result = score_reading({**BASELINE_VALUES, "temperature_c": 37.0})
    assert set(result["features"]) == set(BASELINES)
    assert result["features"]["temperature_c"] == pytest.approx(2.0)
