"""Worker jobs: anomaly scoring, incident lifecycle, data quality."""
from __future__ import annotations

import logging

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .scoring import MODEL_NAME, MODEL_VERSION, score_reading

log = logging.getLogger("sentinelgrid.worker.jobs")

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

def score_new_readings(conn: psycopg.Connection) -> int:
    """Score telemetry readings that have no anomaly_scores row yet."""
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
        for row in rows:
            result = score_reading(row)
            cur.execute(
                """
                insert into anomaly_scores (
                  reading_id, device_id, risk_score, risk_level,
                  model_name, model_version, features, explanation
                ) values (%s, %s, %s, %s, %s, %s, %s, %s)
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
                ),
            )
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
        cur.execute("select device_id, display_name from devices order by device_id")
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


def run_all(conn: psycopg.Connection) -> dict[str, object]:
    scored = score_new_readings(conn)
    incidents = manage_incidents(conn)
    flagged = flag_out_of_order(conn)
    return {"scored": scored, "incidents": incidents, "out_of_order_flagged": flagged}
