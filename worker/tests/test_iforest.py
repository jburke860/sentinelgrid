"""IsolationForest second-model tests (pure, no DB)."""
from __future__ import annotations

import pytest

sklearn = pytest.importorskip("sklearn")

from app import iforest  # noqa: E402
from app.iforest import MODEL_NAME, MODEL_VERSION, refit, score_reading  # noqa: E402
from app.scoring import BASELINES  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_model():
    iforest.reset()
    yield
    iforest.reset()

BASELINE_VALUES = {metric: mean for metric, (mean, _std) in BASELINES.items()}

WILDFIRE_VALUES = {
    **BASELINE_VALUES,
    "smoke_ppm": 8.0,
    "pm25_ugm3": 45.0,
    "temperature_c": 38.0,
    "humidity_pct": 12.0,
}


def test_model_identity():
    result = score_reading(BASELINE_VALUES)
    assert result["model"] == MODEL_NAME == "isolation-forest"
    assert result["version"] == MODEL_VERSION


def test_baseline_reading_is_not_anomalous():
    result = score_reading(BASELINE_VALUES)
    assert result["anomalous"] is False
    assert result["score"] < 50


def test_extreme_reading_is_anomalous():
    result = score_reading(WILDFIRE_VALUES)
    assert result["anomalous"] is True
    assert result["score"] > 50


def test_scores_are_deterministic():
    assert score_reading(WILDFIRE_VALUES) == score_reading(WILDFIRE_VALUES)


def test_missing_metrics_imputed_neutral():
    # Only one metric present: the rest impute to baseline means, so the
    # reading should look normal.
    result = score_reading({"temperature_c": 30.0})
    assert result["anomalous"] is False


def test_score_bounds():
    result = score_reading({m: 10_000.0 for m in BASELINES})
    assert 0 <= result["score"] <= 100


# --- retraining -------------------------------------------------------------

def _real_samples(n: int, seed: int = 7) -> list[dict]:
    import numpy as np

    rng = np.random.default_rng(seed)
    return [
        {m: float(rng.normal(mean, std)) for m, (mean, std) in BASELINES.items()}
        for _ in range(n)
    ]


def test_bootstrap_provenance_is_synthetic():
    assert score_reading(BASELINE_VALUES)["provenance"] == "synthetic"
    info = iforest.provenance()
    assert info["provenance"] == "synthetic"
    assert info["sample_count"] > 0


def test_refit_below_threshold_keeps_synthetic_model(monkeypatch):
    monkeypatch.setenv("SENTINELGRID_IFOREST_MIN_SAMPLES", "1000")
    info = refit(_real_samples(50))
    assert info["provenance"] == "synthetic"
    assert score_reading(BASELINE_VALUES)["provenance"] == "synthetic"


def test_refit_with_enough_samples_switches_to_learned(monkeypatch):
    monkeypatch.setenv("SENTINELGRID_IFOREST_MIN_SAMPLES", "200")
    info = refit(_real_samples(250))
    assert info["provenance"] == "learned"
    assert info["sample_count"] == 250
    assert info["fitted_at"]
    result = score_reading(BASELINE_VALUES)
    assert result["provenance"] == "learned"
    # The learned model must still separate normal from extreme readings.
    assert result["anomalous"] is False
    assert score_reading(WILDFIRE_VALUES)["anomalous"] is True


def test_refit_handles_missing_metrics(monkeypatch):
    monkeypatch.setenv("SENTINELGRID_IFOREST_MIN_SAMPLES", "100")
    samples = _real_samples(120)
    for s in samples[:30]:
        s.pop("water_level_m")  # imputed with the baseline mean
    info = refit(samples)
    assert info["provenance"] == "learned"
    assert 0 <= score_reading(BASELINE_VALUES)["score"] <= 100
