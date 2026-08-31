"""SQLAlchemy 2.0 typed declarative models for the trace store.

Schema:

  run                  one row per externally captured invocation
  event                one row per externally captured event
  route_metric         long-form key/value metrics per run (efficiency, drift, …)
  route_cluster        cluster assignment + distance per (experiment, run)

The long-form `route_metric` shape avoids schema migrations every time a new
trace-analysis metric is added to the prototype.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator[datetime]):
    """Persist UTC-naive in SQLite and always expose aware UTC datetimes.

    SQLite's native datetime adapter discards offsets even when
    ``DateTime(timezone=True)`` is requested. Normalizing at this boundary
    keeps ordering and arithmetic correct while retaining SQLite portability.
    Legacy naive values are interpreted as UTC; callers should re-ingest old
    traces when their original offset was not UTC.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, _dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("UTCDateTime requires an offset-aware datetime")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(
        self, value: datetime | None, _dialect: Any
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class Base(DeclarativeBase):
    pass


class Run(Base):
    __tablename__ = "run"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    task_id: Mapped[str] = mapped_column(String, index=True)
    model: Mapped[str] = mapped_column(String)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime())
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    # Imported label. Current CLI ingests persist ``external``; the targeted
    # startup migration marks pre-provenance rows ``unknown`` rather than
    # making an unsupported claim about their origin.
    outcome: Mapped[str] = mapped_column(String, index=True)
    outcome_source: Mapped[str] = mapped_column(
        String, nullable=False, default="unknown", server_default="unknown"
    )
    total_tokens: Mapped[int] = mapped_column(Integer)
    total_cost_usd: Mapped[float] = mapped_column(Float)
    settings_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    experiment_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)


class Event(Base):
    __tablename__ = "event"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String, ForeignKey("run.id"), index=True)
    event_id: Mapped[str] = mapped_column(String)
    parent_event_id: Mapped[str | None] = mapped_column(String, nullable=True)
    ts: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    type: Mapped[str] = mapped_column(String, index=True)
    target: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    content_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    tokens: Mapped[int] = mapped_column(Integer)
    time_seconds: Mapped[float] = mapped_column(Float)
    task_relevance_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class RouteMetric(Base):
    __tablename__ = "route_metric"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String, ForeignKey("run.id"), index=True)
    name: Mapped[str] = mapped_column(String, index=True)
    value: Mapped[float] = mapped_column(Float)


class RouteCluster(Base):
    __tablename__ = "route_cluster"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    experiment_id: Mapped[str] = mapped_column(String, index=True)
    cluster_id: Mapped[int] = mapped_column(Integer)
    run_id: Mapped[str] = mapped_column(String, ForeignKey("run.id"), index=True)
    distance_to_centroid: Mapped[float] = mapped_column(Float)
    is_representative: Mapped[bool] = mapped_column(Boolean, default=False)
