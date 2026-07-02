"""Welford learned-baseline tests (pure, no DB)."""
from __future__ import annotations

import math
import statistics

import pytest

from app.baselines import (
    MIN_SAMPLES,
    STD_FLOOR_FRAC,
    effective_baselines,
    welford_std,
    welford_update,
)
from app.scoring import BASELINES, compute_zscores


def fold(values):
    state = (0, 0.0, 0.0)
    for v in values:
        state = welford_update(state, v)
    return state


def test_welford_matches_statistics_module():
    values = [12.1, 15.3, 9.8, 14.2, 11.7, 13.9, 10.4, 16.0]
    state = fold(values)
    assert state[0] == len(values)
    assert state[1] == pytest.approx(statistics.fmean(values))
    assert welford_std(state) == pytest.approx(statistics.stdev(values))


def test_welford_std_zero_below_two_samples():
    assert welford_std((0, 0.0, 0.0)) == 0.0
    assert welford_std(welford_update((0, 0.0, 0.0), 5.0)) == 0.0


def test_effective_baselines_fall_back_until_warm():
    cold = fold([25.0] * (MIN_SAMPLES - 1))
    merged = effective_baselines({"temperature_c": cold})
    assert merged["temperature_c"] == BASELINES["temperature_c"]


def test_effective_baselines_use_learned_when_warm():
    # A device that reliably runs at 20C +/- ~2 instead of the 30/3.5 default.
    values = [20.0 + 2.0 * math.sin(i) for i in range(MIN_SAMPLES + 50)]
    merged = effective_baselines({"temperature_c": fold(values)})
    mean, std = merged["temperature_c"]
    assert mean == pytest.approx(20.0, abs=0.5)
    assert std < BASELINES["temperature_c"][1]
    # Other metrics keep their defaults.
    assert merged["humidity_pct"] == BASELINES["humidity_pct"]


def test_std_floor_prevents_collapse():
    flat = fold([30.0] * (MIN_SAMPLES + 10))
    merged = effective_baselines({"temperature_c": flat})
    default_std = BASELINES["temperature_c"][1]
    assert merged["temperature_c"][1] == pytest.approx(STD_FLOOR_FRAC * default_std)


def test_learned_baselines_change_zscores():
    values = [20.0] * (MIN_SAMPLES + 10)
    merged = effective_baselines({"temperature_c": fold(values)})
    z_learned = compute_zscores({"temperature_c": 24.0}, merged)
    z_default = compute_zscores({"temperature_c": 24.0})
    # 24C is below the default baseline but well above this device's learned one.
    assert z_default["temperature_c"] < 0
    assert z_learned["temperature_c"] > 0
