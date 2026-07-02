"""Worker jobs: anomaly scoring, incident lifecycle, data quality, rollups."""
from __future__ import annotations

import logging
import os
from datetime import UTC, datetime

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from . import alerts
from . import baselines as bl
from .scoring import BASELINES, MODEL_NAME, MODEL_VERSION, score_reading

log = logging.getLogger("sentinelgrid.worker.jobs")

# The IsolationForest second model is optional: the worker still runs (zscore
# only) if scikit-learn is unavailable.
try:
    from . import iforest
except ImportError:  # pragma: no cover
    iforest = None
    log.warning("scikit-learn unavailable; isolation-forest scoring disabled")

SCORE_BATCH_LIMIT = 2000
OPEN_STREAK = 2  # consecutive warning+ readings to open an incident
RESOLVE_STREAK = 12  # consecutive normal readings to auto-resolve
ACTIVE_STATUSES = ("open", "acknowledged", "investigating")

HAZARD_TITLES = {
    "wildfire": "Wildfire risk",
    "flood": "Flood risk",
    "hurricane": "Hurricane conditions",
    "heat": "Extreme heat",
    "tornado": "Tornado conditions",
    "winter_storm": "Winter storm conditions",
    "air_quality": "Air quality degradation",
}


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _load_learned_baselines(cur, device_ids: list[str]) -> dict[str, dict[str, bl.Welford]]:
    """device_id -> metric -> (sample_count, mean, m2)."""
    if not device_ids:
        return {}
    cur.execute(
        """
        select device_id, metric, sample_count, mean, m2
        from device_baselines
        where device_id = any(%s)
        """,
        (device_ids,),
    )
    learned: dict[str, dict[str, bl.Welford]] = {}
    for row in cur.fetchall():
        learned.setdefault(row["device_id"], {})[row["metric"]] = (
            row["sample_count"], row["mean"], row["m2"],
        )
    return learned


def _persist_learned_baselines(cur, learned: dict[str, dict[str, bl.Welford]]) -> None:
    for device_id, metrics in learned.items():
        for metric, (count, mean, m2) in metrics.items():
            cur.execute(
                """
                insert into device_baselines (device_id, metric, sample_count, mean, m2, updated_at)
                values (%s, %s, %s, %s, %s, now())
                on conflict (device_id, metric) do update
                  set sample_count = excluded.sample_count,
                      mean = excluded.mean,
                      m2 = excluded.m2,
                      updated_at = now()
                """,
                (device_id, metric, count, mean, m2),
            )


def score_new_readings(conn: psycopg.Connection) -> int:
    """Score telemetry readings that have no anomaly_scores row yet.

    zscore-baseline (against learned per-device baselines once warm) drives
    risk_score/risk_level and incidents; the isolation-forest score rides
    along in model_scores. Normal-level readings feed the learned baselines.
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            select tr.id, tr.device_id,
                   tr.temperature_c, tr.humidity_pct, tr.pm25_ugm3,
                   tr.smoke_ppm, tr.water_level_m, tr.wind_speed_mps
            from telemetry_readings tr
            left join anomaly_scores a on a.reading_id = tr.id
            where a.id is null
            order by tr.observed_at, tr.id
            limit %s
            """,
            (SCORE_BATCH_LIMIT,),
        )
        rows = cur.fetchall()
        learned = _load_learned_baselines(cur, sorted({r["device_id"] for r in rows}))
        touched: dict[str, dict[str, bl.Welford]] = {}

        for row in rows:
            device_learned = learned.setdefault(row["device_id"], {})
            result = score_reading(row, bl.effective_baselines(device_learned))
            model_scores = {}
            if iforest is not None:
                model_scores[iforest.MODEL_NAME] = iforest.score_reading(row)
            cur.execute(
                """
                insert into anomaly_scores (
                  reading_id, device_id, risk_score, risk_level,
                  model_name, model_version, features, explanation, model_scores
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    row["id"],
                    row["device_id"],
                    result["risk_score"],
                    result["risk_level"],
                    MODEL_NAME,
                    MODEL_VERSION,
                    Jsonb(result["features"]),
                    Jsonb(result["explanation"]),
                    Jsonb(model_scores),
                ),
            )
            # Only normal readings train the baseline, so anomalies can't
            # drag it toward themselves.
            if result["risk_level"] == "normal":
                for metric in BASELINES:
                    value = row.get(metric)
                    if value is None:
                        continue
                    state = device_learned.get(metric, (0, 0.0, 0.0))
                    device_learned[metric] = bl.welford_update(state, float(value))
                touched[row["device_id"]] = device_learned

        _persist_learned_baselines(cur, touched)
    conn.commit()
    return len(rows)


# ---------------------------------------------------------------------------
# Incidents
# ---------------------------------------------------------------------------

def _recent_levels(cur, device_id: str, limit: int) -> list[dict]:
    cur.execute(
        """
        select a.risk_score, a.risk_level, a.explanation->>'hazard' as hazard
        from anomaly_scores a
        join telemetry_readings tr on tr.id = a.reading_id
        where a.device_id = %s
        order by tr.observed_at desc, a.id desc
        limit %s
        """,
        (device_id, limit),
    )
    return cur.fetchall()


def _next_incident_key(cur) -> tuple[int, str]:
    cur.execute("select nextval('incidents_id_seq') as id")
    incident_id = cur.fetchone()["id"]
    return incident_id, f"INC-{incident_id:06d}"


def manage_incidents(conn: psycopg.Connection) -> dict[str, int]:
    """Open, escalate, and auto-resolve incidents from recent scores."""
    opened = escalated = resolved = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("select device_id, display_name, region from devices order by device_id")
        devices = cur.fetchall()

        for device in devices:
            device_id = device["device_id"]
            recent = _recent_levels(cur, device_id, RESOLVE_STREAK)
            if not recent:
                continue

            warning_plus = [r["risk_level"] in ("warning", "critical") for r in recent]
            latest = recent[0]

            # --- open ---
            if len(recent) >= OPEN_STREAK and all(warning_plus[:OPEN_STREAK]):
                hazard = latest["hazard"] or "wildfire"
                cur.execute(
                    """
                    select id, severity from incidents
                    where primary_device_id = %s and hazard = %s
                      and status = any(%s)
                    order by opened_at desc
                    limit 1
                    """,
                    (device_id, hazard, list(ACTIVE_STATUSES)),
                )
                active = cur.fetchone()
                severity = "critical" if latest["risk_level"] == "critical" else "warning"
                if active is None:
                    incident_id, key = _next_incident_key(cur)
                    title = f"{HAZARD_TITLES.get(hazard, hazard.title())} near {device['display_name']}"
                    summary = (
                        f"{OPEN_STREAK}+ consecutive {latest['risk_level']}-level readings on "
                        f"{device_id} (risk score {latest['risk_score']}, hazard: {hazard})."
                    )
                    cur.execute(
                        """
                        insert into incidents (
                          id, incident_key, status, severity, hazard, title, summary,
                          location, primary_device_id, risk_score
                        )
                        select %s, %s, 'open', %s, %s, %s, %s,
                               d.location, d.device_id, %s
                        from devices d where d.device_id = %s
                        """,
                        (
                            incident_id, key, severity, hazard, title, summary,
                            latest["risk_score"], device_id,
                        ),
                    )
                    opened += 1
                    # Exactly once per incident: only the open path notifies.
                    alerts.notify_incident({
                        "incident_key": key,
                        "severity": severity,
                        "hazard": hazard,
                        "title": title,
                        "device_id": device_id,
                        "region": device.get("region"),
                        "risk_score": latest["risk_score"],
                        "opened_at": datetime.now(UTC).isoformat(timespec="seconds"),
                    })
                elif severity == "critical" and active["severity"] != "critical":
                    # --- escalate ---
                    cur.execute(
                        "update incidents set severity = 'critical', risk_score = %s where id = %s",
                        (latest["risk_score"], active["id"]),
                    )
                    escalated += 1

            # --- auto-resolve ---
            if len(recent) >= RESOLVE_STREAK and all(
                r["risk_level"] == "normal" for r in recent[:RESOLVE_STREAK]
            ):
                cur.execute(
                    """
                    update incidents
                    set status = 'resolved', closed_at = now()
                    where primary_device_id = %s and status = any(%s)
                    """,
                    (device_id, list(ACTIVE_STATUSES)),
                )
                resolved += cur.rowcount
    conn.commit()
    return {"opened": opened, "escalated": escalated, "resolved": resolved}


# ---------------------------------------------------------------------------
# Data quality
# ---------------------------------------------------------------------------

def flag_out_of_order(conn: psycopg.Connection) -> int:
    """Flag readings whose per-device sequence went backwards (recent window)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            with ordered as (
              select id, sequence,
                     lag(sequence) over (
                       partition by device_id order by observed_at, id
                     ) as prev_seq
              from telemetry_readings
              where ingested_at > now() - interval '1 hour'
            )
            update telemetry_readings tr
            set quality_flags = array_append(tr.quality_flags, 'out_of_order')
            from ordered o
            where tr.id = o.id
              and o.prev_seq is not null
              and o.sequence < o.prev_seq
              and not ('out_of_order' = any(tr.quality_flags))
            """
        )
        flagged = cur.rowcount
    conn.commit()
    return flagged


# ---------------------------------------------------------------------------
# Rollups + retention
# ---------------------------------------------------------------------------

ROLLUP_WINDOW_HOURS = 48
ROLLUP_METRICS = list(BASELINES)


def rollup_hourly(conn: psycopg.Connection) -> int:
    """Upsert hourly per-device rollups over the recent window (idempotent)."""
    agg_cols = ", ".join(
        f"avg({m}) as {m}_avg, min({m}) as {m}_min, max({m}) as {m}_max"
        for m in ROLLUP_METRICS
    )
    insert_cols = ", ".join(
        f"{m}_avg, {m}_min, {m}_max" for m in ROLLUP_METRICS
    )
    update_cols = ", ".join(
        f"{c} = excluded.{c}"
        for m in ROLLUP_METRICS
        for c in (f"{m}_avg", f"{m}_min", f"{m}_max")
    )
    with conn.cursor() as cur:
        cur.execute(
            f"""
            insert into telemetry_rollup_1h (device_id, bucket, reading_count, {insert_cols})
            select device_id, date_trunc('hour', observed_at) as bucket, count(*), {agg_cols}
            from telemetry_readings
            where observed_at > now() - interval '{ROLLUP_WINDOW_HOURS} hours'
            group by device_id, bucket
            on conflict (device_id, bucket) do update
              set reading_count = excluded.reading_count, {update_cols}
            """
        )
        upserted = cur.rowcount
    conn.commit()
    return upserted


def retention_days() -> int:
    return int(os.environ.get("SENTINELGRID_RETENTION_DAYS", "7"))


def prune_old_readings(conn: psycopg.Connection) -> int:
    """Delete raw telemetry older than the retention window (0 disables).

    anomaly_scores rows cascade; hourly rollups keep the history.
    """
    days = retention_days()
    if days <= 0:
        return 0
    with conn.cursor() as cur:
        cur.execute(
            "delete from telemetry_readings where observed_at < now() - make_interval(days => %s)",
            (days,),
        )
        deleted = cur.rowcount
    conn.commit()
    return deleted


def run_all(conn: psycopg.Connection) -> dict[str, object]:
    scored = score_new_readings(conn)
    incidents = manage_incidents(conn)
    flagged = flag_out_of_order(conn)
    return {"scored": scored, "incidents": incidents, "out_of_order_flagged": flagged}


IFOREST_SAMPLE_LIMIT = 5000


def retrain_iforest(conn: psycopg.Connection) -> dict[str, object] | None:
    """Refit the IsolationForest on recent low-risk readings.

    Only normal/watch-level readings are sampled so active events can't
    poison the learned "normal" envelope; iforest.refit() keeps the current
    model when there aren't enough samples yet.
    """
    if iforest is None:
        return None
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            select tr.temperature_c, tr.humidity_pct, tr.pm25_ugm3,
                   tr.smoke_ppm, tr.water_level_m, tr.wind_speed_mps
            from telemetry_readings tr
            join anomaly_scores a on a.reading_id = tr.id
            where a.risk_level in ('normal', 'watch')
            order by tr.observed_at desc
            limit %s
            """,
            (IFOREST_SAMPLE_LIMIT,),
        )
        samples = cur.fetchall()
    return iforest.refit(samples)


def run_maintenance(conn: psycopg.Connection) -> dict[str, object]:
    """Periodic (not every-cycle) jobs: rollups, retention, archival, refit."""
    from . import archive  # local import: MinIO client is optional at runtime

    rolled = rollup_hourly(conn)
    pruned = prune_old_readings(conn)
    archived = archive.archive_new_readings(conn)
    iforest_info = retrain_iforest(conn)
    return {
        "rollup_upserts": rolled,
        "pruned": pruned,
        "archived": archived,
        "iforest": iforest_info,
    }
