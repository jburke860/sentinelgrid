"""IsolationForest anomaly scoring (second model alongside zscore-baseline).

Bootstraps on synthetic samples drawn from the known baseline distributions
(deterministic seed), so it can score from the first cycle without labeled
data or a database. Once enough real telemetry has accumulated, the worker's
maintenance cycle calls refit() with recent low-risk readings and the model
graduates from "synthetic" to "learned" provenance. Pure functions over dicts;
the DB sampling lives in jobs.py.
"""
from __future__ import annotations

import logging
import os
from datetime import UTC, datetime
from typing import Any

import numpy as np
from sklearn.ensemble import IsolationForest

from .scoring import BASELINES

log = logging.getLogger("sentinelgrid.worker.iforest")

MODEL_NAME = "isolation-forest"
MODEL_VERSION = "0.2"

FEATURE_ORDER = list(BASELINES)

_SEED = 42
_TRAIN_SAMPLES = 2048


def min_refit_samples() -> int:
    return int(os.environ.get("SENTINELGRID_IFOREST_MIN_SAMPLES", "1000"))


class _ModelState:
    """Immutable-ish snapshot swapped atomically on refit."""

    __slots__ = ("model", "provenance", "fitted_at", "sample_count")

    def __init__(self, model: IsolationForest, provenance: str, sample_count: int):
        self.model = model
        self.provenance = provenance  # "synthetic" | "learned"
        self.fitted_at = datetime.now(UTC).isoformat(timespec="seconds")
        self.sample_count = sample_count


_state: _ModelState | None = None


def _fit_synthetic() -> _ModelState:
    rng = np.random.default_rng(_SEED)
    train = np.column_stack(
        [rng.normal(mean, std, _TRAIN_SAMPLES) for mean, std in BASELINES.values()]
    )
    model = IsolationForest(
        n_estimators=100, random_state=_SEED, contamination="auto"
    ).fit(train)
    return _ModelState(model, "synthetic", _TRAIN_SAMPLES)


def _get_state() -> _ModelState:
    global _state
    if _state is None:
        _state = _fit_synthetic()
    return _state


def reset() -> None:
    """Test hook: drop back to the lazily-fitted synthetic model."""
    global _state
    _state = None


def provenance() -> dict[str, Any]:
    state = _get_state()
    return {
        "provenance": state.provenance,
        "fitted_at": state.fitted_at,
        "sample_count": state.sample_count,
    }


def refit(samples: list[dict[str, Any]]) -> dict[str, Any]:
    """Refit on real readings (list of metric->value dicts).

    Keeps the current model when there are fewer than min_refit_samples().
    The new model is fully built before the state swap, so concurrent
    score_reading calls never see a half-fitted model.
    """
    global _state
    if len(samples) < min_refit_samples():
        state = _get_state()
        log.info(
            "iforest refit skipped: %d samples < %d required (keeping %s model)",
            len(samples), min_refit_samples(), state.provenance,
        )
        return provenance()
    train = np.array([_feature_vector(s) for s in samples])
    model = IsolationForest(
        n_estimators=100, random_state=_SEED, contamination="auto"
    ).fit(train)
    _state = _ModelState(model, "learned", len(samples))  # atomic swap
    log.info(
        "iforest refit on %d real readings (provenance=learned, fitted_at=%s)",
        _state.sample_count, _state.fitted_at,
    )
    return provenance()


def _feature_vector(values: dict[str, Any]) -> list[float]:
    # Missing metrics are imputed with the baseline mean (neutral contribution).
    return [
        float(values[m]) if values.get(m) is not None else BASELINES[m][0]
        for m in FEATURE_ORDER
    ]


def score_reading(values: dict[str, Any]) -> dict[str, Any]:
    """Score one reading. decision_function is ~[-0.5, 0.5] (lower = more
    anomalous); map it to a 0-100 anomaly score with 50 at the boundary."""
    state = _get_state()
    x = np.array([_feature_vector(values)])
    decision = float(state.model.decision_function(x)[0])
    score = max(0, min(100, round((0.5 - decision) * 100)))
    return {
        "model": MODEL_NAME,
        "version": MODEL_VERSION,
        "score": score,
        "decision": round(decision, 4),
        "anomalous": decision < 0.0,
        "provenance": state.provenance,
    }
