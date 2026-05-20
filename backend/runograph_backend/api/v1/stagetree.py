"""GET /api/v1/stagetree — 5-stage pipeline + per-stage action space.

Bit-locked to Figma page \"06 Stage-tree\" (node 78:2). Phase A returns
the canon fixture (Edit stage selected by default, 4 model candidates,
8-row EV decomposition for the Edit node, 3-row downstream-impact
projection). Phase B+ populates from sim-run aggregator.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1", tags=["stagetree"])

StageStatus = Literal["complete", "current", "pending"]
EVDecompTone = Literal["success", "danger"]


class StageNode(BaseModel):
    id: str
    name: str
    status: StageStatus
    chosen_model: str = Field(..., alias="chosenModel")
    ev: str

    model_config = {"populate_by_name": True}


class StageCandidate(BaseModel):
    model: str
    is_chosen: bool = Field(False, alias="isChosen")
    ev: str
    ev_caption: str = Field(..., alias="evCaption")
    passes: int
    total: int
    pass_rate: str = Field(..., alias="passRate")
    cost_per_run: str = Field(..., alias="costPerRun")
    latency_p50: str = Field(..., alias="latencyP50")

    model_config = {"populate_by_name": True}


class StageEVDecompRow(BaseModel):
    signal: str
    weight: str
    contribution: str
    tone: EVDecompTone


class StageEVDecomp(BaseModel):
    rows: list[StageEVDecompRow]
    total: str


class DownstreamProjection(BaseModel):
    model: str
    test_delta: str = Field(..., alias="testDelta")
    repair_delta: str = Field(..., alias="repairDelta")
    composite_delta: str = Field(..., alias="compositeDelta")

    model_config = {"populate_by_name": True}


class StageTreeResponse(BaseModel):
    harness: str
    stages: list[StageNode]
    selected_stage: str = Field(..., alias="selectedStage")
    selected_stage_description: str = Field(..., alias="selectedStageDescription")
    candidates: list[StageCandidate]
    ev_decomposition: StageEVDecomp = Field(..., alias="evDecomposition")
    downstream_projections: list[DownstreamProjection] = Field(
        ..., alias="downstreamProjections"
    )
    projection_summary: str = Field(..., alias="projectionSummary")

    model_config = {"populate_by_name": True}


def _mock_response() -> StageTreeResponse:
    return StageTreeResponse(
        harness="Harness B",
        stages=[
            StageNode(id="plan", name="Planning", status="complete", chosenModel="claude-haiku", ev="+0.04"),
            StageNode(id="retrieve", name="Retrieval", status="complete", chosenModel="dense · k=12", ev="+0.07"),
            StageNode(id="edit", name="Edit", status="current", chosenModel="claude-sonnet", ev="+0.31"),
            StageNode(id="test", name="Test", status="pending", chosenModel="pytest (proj)", ev="+0.06"),
            StageNode(id="repair", name="Repair", status="pending", chosenModel="3-retry (proj)", ev="+0.04"),
        ],
        selectedStage="edit",
        selectedStageDescription="Agent rewrites code to address the task. Decision: which model emits the patch.",
        candidates=[
            StageCandidate(
                model="claude-sonnet",
                isChosen=True,
                ev="+0.31",
                evCaption="EV at this node",
                passes=47,
                total=50,
                passRate="94%",
                costPerRun="$0.12 / run",
                latencyP50="1.4 s p50",
            ),
            StageCandidate(
                model="gpt-5-mini",
                ev="+0.04",
                evCaption="EV if chosen here",
                passes=38,
                total=50,
                passRate="76%",
                costPerRun="$0.04 / run",
                latencyP50="0.8 s p50",
            ),
            StageCandidate(
                model="gemini-2.5",
                ev="−0.05",
                evCaption="EV if chosen here",
                passes=31,
                total=50,
                passRate="62%",
                costPerRun="$0.18 / run",
                latencyP50="2.1 s p50",
            ),
            StageCandidate(
                model="claude-haiku",
                ev="+0.18",
                evCaption="EV if chosen here",
                passes=42,
                total=50,
                passRate="84%",
                costPerRun="$0.03 / run",
                latencyP50="0.6 s p50",
            ),
        ],
        evDecomposition=StageEVDecomp(
            total="+0.320",
            rows=[
                StageEVDecompRow(signal="Human quality", weight="0.25", contribution="+0.210", tone="success"),
                StageEVDecompRow(signal="Test pass rate", weight="0.15", contribution="+0.135", tone="success"),
                StageEVDecompRow(signal="Route efficiency", weight="0.10", contribution="+0.030", tone="success"),
                StageEVDecompRow(signal="Reliability", weight="0.15", contribution="+0.060", tone="success"),
                StageEVDecompRow(signal="Cost", weight="0.10", contribution="−0.042", tone="danger"),
                StageEVDecompRow(signal="Latency", weight="0.10", contribution="−0.032", tone="danger"),
                StageEVDecompRow(signal="Regression risk", weight="0.10", contribution="−0.020", tone="danger"),
                StageEVDecompRow(signal="Human correction", weight="0.05", contribution="−0.021", tone="danger"),
            ],
        ),
        downstreamProjections=[
            DownstreamProjection(model="claude-haiku", testDelta="+0.02", repairDelta="−0.01", compositeDelta="−0.130"),
            DownstreamProjection(model="gpt-5-mini", testDelta="+0.01", repairDelta="+0.03", compositeDelta="−0.270"),
            DownstreamProjection(model="gemini-2.5", testDelta="−0.18", repairDelta="+0.06", compositeDelta="−0.360"),
        ],
        projectionSummary="All three alternates project negative composite Δ — claude-sonnet remains the +EV pick at this node.",
    )


@router.get("/stagetree", response_model=StageTreeResponse, response_model_by_alias=True)
async def get_stagetree() -> StageTreeResponse:
    return _mock_response()
