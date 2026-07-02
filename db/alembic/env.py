"""Alembic environment: raw-SQL migrations, DSN from DATABASE_URL."""
from __future__ import annotations

import os

from alembic import context
from sqlalchemy import create_engine

DEFAULT_DATABASE_URL = "postgresql://sentinelgrid:sentinelgrid@localhost:5432/sentinelgrid"


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    # Normalize to a psycopg3 SQLAlchemy dialect either way.
    url = url.replace("postgresql+psycopg://", "postgresql://", 1)
    return url.replace("postgresql://", "postgresql+psycopg://", 1)


def run_migrations_offline() -> None:
    context.configure(url=database_url(), literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(database_url())
    with engine.connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
