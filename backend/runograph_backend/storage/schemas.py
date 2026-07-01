"""Pydantic v2 schemas mirroring the canonical event format proposed in the
Monte-Carlo agent-route research doc (2026-05-20).

Producers (the Claude Code orchestrator + PostToolUse hooks) write
events.jsonl + meta.json files; consumers (the ingest pipeline) parse them
into these schemas, then into the SQLAlchemy models in `models.py`.

Aliases use camelCase so the JSON wire format matches the React consumer
pattern used across the /api/v1 surface.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

EventType = Literal[
    "file_read",
    "file_edit",
    "test_run",
    "tool_call",
    "error",
    "reflection",
    "final",
]

Outcome = Literal["running", "pass", "fail", "error"]


class EventCost(BaseModel):
    tokens: int = 0
    time_seconds: float = Field(0.0, alias="timeSeconds")

    model_config = {"populate_by_name": True}


class CanonicalEvent(BaseModel):
    """One captured agent event. Shape matches the research doc's Phase-1
    schema: event_id, timestamp, type, target, content_summary, cost,
    parent_event_id, task_relevance_score."""

    event_id: str = Field(..., alias="eventId")
    timestamp: datetime
    type: EventType
    target: str | None = None
    content_summary: str | None = Field(None, alias="contentSummary")
    cost: EventCost = Field(default_factory=EventCost)
    parent_event_id: str | None = Field(None, alias="parentEventId")
    task_relevance_score: float | None = Field(None, alias="taskRelevanceScore")

    model_config = {"populate_by_name": True}


class RunMeta(BaseModel):
    """Run-level metadata written to meta.json by the orchestrator after
    teardown. The grader fills outcome + ended_at."""

    run_id: str = Field(..., alias="runId")
    task_id: str = Field(..., alias="taskId")
    model: str
    started_at: datetime = Field(..., alias="startedAt")
    ended_at: datetime | None = Field(None, alias="endedAt")
    outcome: Outcome
    total_tokens: int = Field(0, alias="totalTokens")
    total_cost_usd: float = Field(0.0, alias="totalCostUsd")
    experiment_id: str | None = Field(None, alias="experimentId")
    settings_hash: str | None = Field(None, alias="settingsHash")

    model_config = {"populate_by_name": True}


class RunSummary(BaseModel):
    """Compact view of a Run row — what GET /api/v1/runs returns."""

    run_id: str = Field(..., alias="runId")
    task_id: str = Field(..., alias="taskId")
    model: str
    outcome: Outcome
    total_tokens: int = Field(..., alias="totalTokens")
    total_cost_usd: float = Field(..., alias="totalCostUsd")
    started_at: datetime = Field(..., alias="startedAt")
    ended_at: datetime | None = Field(None, alias="endedAt")
    experiment_id: str | None = Field(None, alias="experimentId")
    event_count: int = Field(0, alias="eventCount")

    model_config = {"populate_by_name": True}


class IngestRequest(BaseModel):
    run_dir: str = Field(..., alias="runDir")
    model_config = {"populate_by_name": True}


class IngestResponse(BaseModel):
    run_id: str = Field(..., alias="runId")
    events_ingested: int = Field(..., alias="eventsIngested")
    model_config = {"populate_by_name": True}
