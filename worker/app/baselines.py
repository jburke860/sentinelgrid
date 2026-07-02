"""Incrementally learned per-device/per-metric baselines (Welford's algorithm).

The worker folds each *normal-level* reading into device_baselines; once a
device/metric pair has enough samples, the z-score model prefers the learned
(mean, std) over the hardcoded defaults. Anomalous readings are excluded so
incidents don't drag the baseline toward the anomaly.
"""
from __future__ import annotations

import math

from .scoring import BASELINES

# Samples required before a learned baseline replaces the default.
MIN_SAMPLES = 300
# Learned std never collapses below this fraction of the default std, so a
# quiet sensor can't make routine noise look critical.
STD_FLOOR_FRAC = 0.25

# (sample_count, mean, m2) triple per metric.
Welford = tuple[int, float, float]


def welford_update(state: Welford, value: float) -> Welford:
    count, mean, m2 = state
    count += 1
    delta = value - mean
    mean += delta / count
    m2 += delta * (value - mean)
    return count, mean, m2


def welford_std(state: Welford) -> float:
    count, _mean, m2 = state
    if count < 2:
        return 0.0
    return math.sqrt(m2 / (count - 1))


def effective_baselines(learned: dict[str, Welford]) -> dict[str, tuple[float, float]]:
    """Merge learned states over the hardcoded defaults."""
    merged: dict[str, tuple[float, float]] = {}
    for metric, (default_mean, default_std) in BASELINES.items():
        state = learned.get(metric)
        if state is not None and state[0] >= MIN_SAMPLES:
            std = max(welford_std(state), STD_FLOOR_FRAC * default_std)
            merged[metric] = (state[1], std)
        else:
            merged[metric] = (default_mean, default_std)
    return merged
