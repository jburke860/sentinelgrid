"""Worker loop: score readings, manage incidents, run data-quality checks.

Every SENTINELGRID_MAINTENANCE_INTERVAL_S (default 300s) it also runs the
maintenance jobs: hourly rollups, raw-telemetry retention, MinIO archival.
"""
from __future__ import annotations

import json
import logging
import os
import time

import psycopg

from . import db, jobs


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            entry["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(entry)


if os.environ.get("SENTINELGRID_LOG_JSON", "0") in ("1", "true", "yes"):
    _handler = logging.StreamHandler()
    _handler.setFormatter(_JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[_handler])
else:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
    )
log = logging.getLogger("sentinelgrid.worker")


def main() -> None:
    interval_s = float(os.environ.get("SCORE_INTERVAL_S", "10"))
    maintenance_interval_s = float(
        os.environ.get("SENTINELGRID_MAINTENANCE_INTERVAL_S", "300")
    )
    log.info(
        "worker starting (interval=%.0fs, maintenance every %.0fs)",
        interval_s, maintenance_interval_s,
    )
    conn = db.connect_with_retry()
    last_maintenance = 0.0
    while True:
        started = time.monotonic()
        try:
            summary = jobs.run_all(conn)
            if summary["scored"] or any(summary["incidents"].values()) or summary["out_of_order_flagged"]:
                log.info("cycle: %s", summary)
            if started - last_maintenance >= maintenance_interval_s:
                last_maintenance = started
                maintenance = jobs.run_maintenance(conn)
                if any(maintenance.values()):
                    log.info("maintenance: %s", maintenance)
        except psycopg.OperationalError as exc:
            log.warning("lost database connection (%s); reconnecting", exc)
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
            conn = db.connect_with_retry()
        except Exception:  # noqa: BLE001
            log.exception("job cycle failed; rolling back")
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                pass
        elapsed = time.monotonic() - started
        time.sleep(max(0.0, interval_s - elapsed))


if __name__ == "__main__":
    main()
