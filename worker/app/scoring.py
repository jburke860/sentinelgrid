"""Z-score baseline anomaly scoring.

Port of the browser engine's approach: per-metric z-scores against fixed
baselines, combined into hazard profiles via weighted sums of the
positive-direction z contributions. Pure functions, no DB.
"""
from __future__ import annotations

from typing import Any

MODEL_NAME = "zscore-baseline"
MODEL_VERSION = "0.1"

# metric -> (baseline mean, std)
BASELINES: dict[str, tuple[float, float]] = {
    "temperature_c": (30.0, 3.5),
    "humidity_pct": (28.0, 8.0),
    "pm25_ugm3": (16.0, 6.0),
    "smoke_ppm": (2.0, 1.0),
    "water_level_m": (1.2, 0.15),
    "wind_speed_mps": (4.5, 1.2),
}

RISK_LEVELS = (
    (75, "critical"),
    (50, "warning"),
    (25, "watch"),
)


def compute_zscores(values: dict[str, Any]) -> dict[str, float]:
    """Z-score each known metric; missing/None metrics contribute 0."""
    z: dict[str, float] = {}
    for metric, (mean, std) in BASELINES.items():
        value = values.get(metric)
        z[metric] = 0.0 if value is None else (float(value) - mean) / std
    return z


def _pos(x: float) -> float:
    return x if x > 0.0 else 0.0


def hazard_scores(z: dict[str, float]) -> dict[str, float]:
    """Weighted sums of max(0, direction * z) per hazard profile."""
    temp = _pos(z["temperature_c"])
    hum = _pos(z["humidity_pct"])
    pm25 = _pos(z["pm25_ugm3"])
    smoke = _pos(z["smoke_ppm"])
    water = _pos(z["water_level_m"])
    wind = _pos(z["wind_speed_mps"])
    dryness = _pos(-z["humidity_pct"])
    cold = _pos(-z["temperature_c"])

    return {
        "wildfire": 0.5 * smoke + 0.3 * pm25 + 0.2 * temp + 0.1 * dryness,
        "flood": 0.75 * water + 0.25 * wind,
        "hurricane": 0.5 * wind + 0.35 * water + 0.15 * hum,
        "heat": 0.8 * temp + 0.2 * dryness,
        "tornado": 0.75 * wind + 0.15 * hum + 0.1 * temp,
        "winter_storm": 0.6 * cold + 0.4 * wind,
        "air_quality": 0.6 * pm25 + 0.4 * smoke,
    }


def risk_level(score: int) -> str:
    for threshold, level in RISK_LEVELS:
        if score >= threshold:
            return level
    return "normal"


def score_reading(values: dict[str, Any]) -> dict[str, Any]:
    """Score one reading's metric values.

    Returns risk_score (0-100), risk_level, top hazard, plus the z-scores
    (features) and an explanation payload for anomaly_scores.
    """
    z = compute_zscores(values)
    hazards = hazard_scores(z)
    ranked = sorted(hazards.items(), key=lambda kv: kv[1], reverse=True)
    top_hazard, top_value = ranked[0]

    score = max(0, min(100, round(top_value * 16)))
    return {
        "risk_score": score,
        "risk_level": risk_level(score),
        "hazard": top_hazard,
        "features": {metric: round(v, 4) for metric, v in z.items()},
        "explanation": {
            "hazard": top_hazard,
            "top": [
                {"hazard": name, "score": round(value, 4)}
                for name, value in ranked[:3]
            ],
        },
    }
