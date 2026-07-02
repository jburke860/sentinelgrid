"""Baseline: schema as created by infra/db/init/001-004.

This revision is intentionally empty. Databases bootstrapped by the compose
init scripts (001_extensions, 002_schema, 003_seed_devices, 004_device_kind)
already have this schema — mark them with:

    make db-stamp        # alembic stamp 0001

Fresh databases NOT using the init scripts are out of scope: bootstrap with
the init scripts first, then stamp and upgrade.

Revision ID: 0001
Revises:
"""
from __future__ import annotations

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
