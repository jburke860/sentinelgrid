from __future__ import annotations


def score_reading(reading: dict) -> dict[str, object]:
    readings = reading.get("readings", {})
    health = reading.get("health", {})
    flags: list[str] = []
    score = 0

    if readings.get("temperature_c", 0) >= 40:
        score += 35
        flags.append("high_temperature")
    if readings.get("pm25_ugm3", 0) >= 55:
        score += 30
        flags.append("poor_air_quality")
    if readings.get("smoke_ppm", 0) >= 8:
        score += 25
        flags.append("smoke_detected")
    if health.get("battery_pct", 100) <= 15:
        score += 10
        flags.append("low_battery")

    if score >= 70:
        level = "critical"
    elif score >= 45:
        level = "warning"
    elif score >= 20:
        level = "watch"
    else:
        level = "normal"

    return {"risk_score": min(score, 100), "risk_level": level, "flags": flags}


if __name__ == "__main__":
    sample = {
        "readings": {"temperature_c": 42.1, "pm25_ugm3": 61.0, "smoke_ppm": 4.0},
        "health": {"battery_pct": 78.5},
    }
    print(score_reading(sample))

