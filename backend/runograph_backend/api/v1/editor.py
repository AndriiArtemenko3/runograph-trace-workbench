"""GET /api/v1/editor — harness pipeline as a DAG + YAML serialization.

Phase A: fixture matches the canon Harness B configuration (haiku
triage → sonnet edit / 3-retry repair). Phase B+ persists user-edited
DAGs to the backend store; for v0.3 the page is read-only / view-only
per the locked 60-second demo script.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1", tags=["editor"])

StageKind = Literal["plan", "retrieve", "edit", "test", "repair"]


class NodePosition(BaseModel):
    x: float
    y: float


class NodeData(BaseModel):
    label: str
    kind: StageKind
    model: str
    detail: str | None = None


class EditorNode(BaseModel):
    id: str
    position: NodePosition
    data: NodeData
    type: Literal["stage"] = "stage"


class EditorEdge(BaseModel):
    id: str
    source: str
    target: str
    label: str | None = None


class EditorResponse(BaseModel):
    harness_id: str = Field(..., alias="harnessId")
    harness_name: str = Field(..., alias="harnessName")
    nodes: list[EditorNode]
    edges: list[EditorEdge]
    yaml: str

    model_config = {"populate_by_name": True}


_CANON_YAML = """\
# Harness B — haiku triage → sonnet edit / 3-retry repair
# v0.3 alpha · read-only view in this build · editable in v0.4

id: harness-b
name: haiku-triage-sonnet-edit
target: swe-bench-lite / bug-fix

stages:
  - id: plan
    kind: plan
    model: claude-haiku
    budget:
      max_tokens: 800
      max_seconds: 8

  - id: retrieve
    kind: retrieve
    backend: dense-bge-large
    k: 12
    rerank: cohere-rerank-3.5

  - id: edit
    kind: edit
    model: claude-sonnet
    multi_file: true
    budget:
      max_tokens: 12000
      max_seconds: 45

  - id: test
    kind: test
    runner: pytest
    timeout_seconds: 60

  - id: repair
    kind: repair
    strategy: 3-retry
    on_fail: rollback
    model: claude-sonnet

weights:
  human_quality: 0.25
  test_pass_rate: 0.15
  route_efficiency: 0.10
  reliability: 0.15
  cost: 0.10
  latency: 0.10
  regression_risk: 0.10
  human_correction: 0.05

sim:
  runs_per_task: 50
  seeds: [42, 1729, 31337]
"""


def _mock_response() -> EditorResponse:
    # Vertical layout — keeps the 5-node DAG legible inside a ~680 px
    # center-pane canvas without ReactFlow's fitView zooming out so far
    # the nodes become unreadable. Horizontal arrangement waits for a
    # wider Editor screen (the canon 1440-wide Node-editor v2 page lands
    # with the v0.4 editing unlock).
    stages = [
        ("plan", "Plan", "claude-haiku", "budget: 800 tok / 8 s", 0.0, 0.0),
        ("retrieve", "Retrieve", "dense-bge-large", "k=12 · cohere rerank", 0.0, 130.0),
        ("edit", "Edit", "claude-sonnet", "multi-file · 12 000 tok", 0.0, 260.0),
        ("test", "Test", "pytest", "timeout 60 s", 0.0, 390.0),
        ("repair", "Repair", "claude-sonnet", "3-retry · rollback on fail", 0.0, 520.0),
    ]
    nodes = [
        EditorNode(
            id=stage_id,
            position=NodePosition(x=x, y=y),
            data=NodeData(label=label, kind=stage_id, model=model, detail=detail),
        )
        for (stage_id, label, model, detail, x, y) in stages
    ]
    edges = [
        EditorEdge(id="plan-retrieve", source="plan", target="retrieve"),
        EditorEdge(id="retrieve-edit", source="retrieve", target="edit"),
        EditorEdge(id="edit-test", source="edit", target="test"),
        EditorEdge(id="test-repair", source="test", target="repair", label="on-fail"),
    ]
    return EditorResponse(
        harnessId="harness-b",
        harnessName="haiku-triage → sonnet-edit",
        nodes=nodes,
        edges=edges,
        yaml=_CANON_YAML,
    )


@router.get("/editor", response_model=EditorResponse, response_model_by_alias=True)
async def get_editor() -> EditorResponse:
    return _mock_response()
