"""SQLAlchemy 2.0 typed declarative models for the trace store.

Schema (Phase B+ — first persistent layer beyond the FastAPI mock fixtures):

  run                  one row per Claude Code invocation
  event                one row per captured event (PostToolUse hook + stream)
  route_metric         long-form key/value metrics per run (efficiency, drift, …)
  route_cluster        cluster assignment + distance per (experiment, run)

The long-form `route_metric` shape avoids schema migrations every time a new
metric definition lands during the route-evaluation research phase.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Run(Base):
    __tablename__ = "run"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    task_id: Mapped[str] = mapped_column(String, index=True)
    model: Mapped[str] = mapped_column(String)
    started_at: Mapped[datetime] = mapped_column(DateTime)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    outcome: Mapped[str] = mapped_column(String, index=True)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    settings_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    experiment_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)


class Event(Base):
    __tablename__ = "event"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String, ForeignKey("run.id"), index=True)
    event_id: Mapped[str] = mapped_column(String)
    parent_event_id: Mapped[str | None] = mapped_column(String, nullable=True)
    ts: Mapped[datetime] = mapped_column(DateTime, index=True)
    type: Mapped[str] = mapped_column(String, index=True)
    target: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    content_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    time_seconds: Mapped[float] = mapped_column(Float, default=0.0)
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
