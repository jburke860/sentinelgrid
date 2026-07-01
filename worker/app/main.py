"""Worker loop: score readings, manage incidents, run data-quality checks."""
from __future__ import annotations

import logging
import os
import time

import psycopg

from . import db, jobs

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
log = logging.getLogger("sentinelgrid.worker")


def main() -> None:
    interval_s = float(os.environ.get("SCORE_INTERVAL_S", "10"))
    log.info("worker starting (interval=%.0fs)", interval_s)
    conn = db.connect_with_retry()
    while True:
        started = time.monotonic()
        try:
            summary = jobs.run_all(conn)
            if summary["scored"] or any(summary["incidents"].values()) or summary["out_of_order_flagged"]:
                log.info("cycle: %s", summary)
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
