"""Solver-grid response models + the GET /api/v1/solver-grid endpoint.

Phase A: returns mocked-but-realistic data so the SolverGrid page can render a
full canon-shaped view before the sim engine lands. The fixtures here mirror
the 60-second demo-script narrative — 4 harnesses, B winning by +0.32 EV over
A, edit stage driving most of the delta.

Phase B+: the same response schema gets populated from the DuckDB-aggregated
sim run results, no change to the React consumer.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1", tags=["solver-grid"])

EVSign = Literal["positive", "negative"]
EVMagnitude = Literal[1, 2, 3, 4, 5]


class MatrixCell(BaseModel):
    label: str = Field(..., description="Column label, e.g. 'T1'")
    value: str = Field(..., description="Display string with sign, e.g. '+0.41'")
    sign: EVSign
    magnitude: EVMagnitude


class Harness(BaseModel):
    id: Literal["A", "B", "C", "D"]
    name: str
    ev: str
    ev_sign: EVSign = Field(..., alias="evSign")
    ev_magnitude: EVMagnitude = Field(..., alias="evMagnitude")
    ci: str = Field(..., description="95% CI string, e.g. '±0.04'")
    winner: bool = False
    cells: list[MatrixCell]

    model_config = {"populate_by_name": True}


class StageRow(BaseModel):
    stage: str
    ev: str
    selected: bool = False


class RecommendationBullet(BaseModel):
    text: str
    tone: Literal["neutral", "accent"] = "neutral"


class RecommendationPillContent(BaseModel):
    kind: Literal["top-pick", "runner-up"]
    harness_id: str = Field(..., alias="harnessId")
    ev: str
    descriptor: str
    bullets: list[RecommendationBullet]

    model_config = {"populate_by_name": True}


class Recommendation(BaseModel):
    top_pick: RecommendationPillContent = Field(..., alias="topPick")
    runner_up: RecommendationPillContent = Field(..., alias="runnerUp")

    model_config = {"populate_by_name": True}


class StageDecompCell(BaseModel):
    value: str
    sign: EVSign
    magnitude: EVMagnitude


class StageDecompRow(BaseModel):
    stage: str
    a: StageDecompCell
    b: StageDecompCell
    c: StageDecompCell
    d: StageDecompCell


class FailureClassRow(BaseModel):
    failure_class: str = Field(..., alias="failureClass")
    a: str = "0%"
    b: str = "0%"
    c: str = "0%"
    d: str = "0%"

    model_config = {"populate_by_name": True}


class SolverGridResponse(BaseModel):
    task_class: str = Field(..., alias="taskClass")
    sims_per_harness: int = Field(..., alias="simsPerHarness")
    iter_complete: int = Field(..., alias="iterComplete")
    iter_total: int = Field(..., alias="iterTotal")
    weight_profile: str = Field(..., alias="weightProfile")
    harnesses: list[Harness]
    stages: list[StageRow]
    stage_decomposition: list[StageDecompRow] = Field(..., alias="stageDecomposition")
    failure_classes: list[FailureClassRow] = Field(..., alias="failureClasses")
    recommendation: Recommendation

    model_config = {"populate_by_name": True}


def _mock_response() -> SolverGridResponse:
    """Phase-A fixture. Mirrors the demo-script numbers verbatim."""
    return SolverGridResponse(
        taskClass="bug-fix",
        simsPerHarness=1200,
        iterComplete=7412,
        iterTotal=12_000,
        weightProfile="balanced",
        harnesses=[
            Harness(
                id="A",
                name="single-sonnet",
                ev="+0.20",
                evSign="positive",
                evMagnitude=2,
                ci="±0.04",
                cells=[
                    MatrixCell(label="T1", value="+0.18", sign="positive", magnitude=2),
                    MatrixCell(label="T2", value="+0.24", sign="positive", magnitude=3),
                    MatrixCell(label="T3", value="−0.08", sign="negative", magnitude=1),
                    MatrixCell(label="T4", value="+0.31", sign="positive", magnitude=4),
                    MatrixCell(label="T5", value="+0.15", sign="positive", magnitude=2),
                ],
            ),
            Harness(
                id="B",
                name="haiku-triage → sonnet-edit",
                ev="+0.52",
                evSign="positive",
                evMagnitude=5,
                ci="±0.03",
                winner=True,
                cells=[
                    MatrixCell(label="T1", value="+0.41", sign="positive", magnitude=4),
                    MatrixCell(label="T2", value="+0.62", sign="positive", magnitude=5),
                    MatrixCell(label="T3", value="+0.28", sign="positive", magnitude=3),
                    MatrixCell(label="T4", value="+0.57", sign="positive", magnitude=5),
                    MatrixCell(label="T5", value="+0.49", sign="positive", magnitude=4),
                ],
            ),
            Harness(
                id="C",
                name="haiku-only",
                ev="−0.11",
                evSign="negative",
                evMagnitude=2,
                ci="±0.05",
                cells=[
                    MatrixCell(label="T1", value="−0.04", sign="negative", magnitude=1),
                    MatrixCell(label="T2", value="+0.08", sign="positive", magnitude=1),
                    MatrixCell(label="T3", value="−0.22", sign="negative", magnitude=3),
                    MatrixCell(label="T4", value="−0.14", sign="negative", magnitude=2),
                    MatrixCell(label="T5", value="−0.06", sign="negative", magnitude=1),
                ],
            ),
            Harness(
                id="D",
                name="sonnet + 3-retry repair",
                ev="+0.34",
                evSign="positive",
                evMagnitude=3,
                ci="±0.06",
                cells=[
                    MatrixCell(label="T1", value="+0.29", sign="positive", magnitude=3),
                    MatrixCell(label="T2", value="+0.41", sign="positive", magnitude=4),
                    MatrixCell(label="T3", value="+0.12", sign="positive", magnitude=2),
                    MatrixCell(label="T4", value="+0.38", sign="positive", magnitude=4),
                    MatrixCell(label="T5", value="+0.22", sign="positive", magnitude=3),
                ],
            ),
        ],
        stages=[
            StageRow(stage="plan", ev="+0.04"),
            StageRow(stage="search", ev="+0.07"),
            StageRow(stage="edit", ev="+0.31", selected=True),
            StageRow(stage="test", ev="+0.06"),
            StageRow(stage="review", ev="+0.04"),
        ],
        stage_decomposition=[
            StageDecompRow(
                stage="plan",
                a=StageDecompCell(value="+0.04", sign="positive", magnitude=1),
                b=StageDecompCell(value="+0.04", sign="positive", magnitude=1),
                c=StageDecompCell(value="−0.02", sign="negative", magnitude=1),
                d=StageDecompCell(value="−0.05", sign="negative", magnitude=2),
            ),
            StageDecompRow(
                stage="search",
                a=StageDecompCell(value="+0.08", sign="positive", magnitude=1),
                b=StageDecompCell(value="+0.07", sign="positive", magnitude=1),
                c=StageDecompCell(value="+0.01", sign="positive", magnitude=1),
                d=StageDecompCell(value="−0.09", sign="negative", magnitude=2),
            ),
            StageDecompRow(
                stage="edit",
                a=StageDecompCell(value="+0.05", sign="positive", magnitude=1),
                b=StageDecompCell(value="+0.31", sign="positive", magnitude=5),
                c=StageDecompCell(value="−0.01", sign="negative", magnitude=1),
                d=StageDecompCell(value="−0.07", sign="negative", magnitude=2),
            ),
            StageDecompRow(
                stage="test",
                a=StageDecompCell(value="+0.02", sign="positive", magnitude=1),
                b=StageDecompCell(value="+0.06", sign="positive", magnitude=1),
                c=StageDecompCell(value="+0.01", sign="positive", magnitude=1),
                d=StageDecompCell(value="−0.06", sign="negative", magnitude=2),
            ),
            StageDecompRow(
                stage="repair",
                a=StageDecompCell(value="+0.01", sign="positive", magnitude=1),
                b=StageDecompCell(value="+0.04", sign="positive", magnitude=1),
                c=StageDecompCell(value="+0.00", sign="positive", magnitude=1),
                d=StageDecompCell(value="−0.03", sign="negative", magnitude=1),
            ),
        ],
        failureClasses=[
            FailureClassRow(failureClass="orphan-loop", a="18%", b="6%", c="22%", d="19%"),
            FailureClassRow(failureClass="skip-load-bearing", a="12%", b="4%", c="9%", d="14%"),
            FailureClassRow(failureClass="context-overflow", a="7%", b="3%", c="11%", d="28%"),
            FailureClassRow(failureClass="citation-no-trav", a="9%", b="5%", c="13%", d="16%"),
            FailureClassRow(failureClass="under-connected", a="8%", b="4%", c="17%", d="11%"),
        ],
        recommendation=Recommendation(
            topPick=RecommendationPillContent(
                kind="top-pick",
                harnessId="Harness B",
                ev="+0.52",
                descriptor="claude-haiku triage → sonnet edit → claude-judge / 3-retry",
                bullets=[
                    RecommendationBullet(text="47 of 50 bug-fix tasks passed (94%)"),
                    RecommendationBullet(text="−42% token spend vs frontier-only"),
                    RecommendationBullet(
                        text="discovery: triage-then-escalate beats single-model on multi-file edits",
                        tone="accent",
                    ),
                ],
            ),
            runnerUp=RecommendationPillContent(
                kind="runner-up",
                harnessId="Harness A",
                ev="+0.20",
                descriptor="claude-sonnet / dense retrieval / no triage",
                bullets=[
                    RecommendationBullet(text="36 of 50 bug-fix tasks passed (72%)"),
                    RecommendationBullet(text="lowest p95 latency in the set (3.4 s)"),
                ],
            ),
        ),
    )


@router.get("/solver-grid", response_model=SolverGridResponse, response_model_by_alias=True)
async def get_solver_grid() -> SolverGridResponse:
    """Phase-A mock; Phase-B+ replaces _mock_response with DuckDB aggregator."""
    return _mock_response()
