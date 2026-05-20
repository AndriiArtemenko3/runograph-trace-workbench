"""GET /api/v1/heatmap — corpus tile grid + agent path overlay.

Phase A: mocked-but-realistic data so the HeatMap page renders the full
canon-shaped view (7 districts × 4-9 tiles, 5-step agent path). Phase
B+ populates the same response from a real run aggregator: per-file
productivity heat (helped-the-agent-reach +EV) + pollution heat
(caused failure-class events) for the active harness.

Canon: page \"04 Heat-map exploration\" (node 51:2). v0.3 ships the
tile-grid variant (B); the treemap variant (A) defers to v0.4.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1", tags=["heatmap"])

HeatLevel = Literal["low", "med", "high"]


class HeatTileData(BaseModel):
    id: str
    filename: str
    productivity: HeatLevel
    pollution: HeatLevel
    reads: int = 0
    retrievals: int = 0
    ev_contribution: str = Field("+0.00", alias="evContribution")

    model_config = {"populate_by_name": True}


class HeatDistrict(BaseModel):
    id: str
    name: str
    file_count: int = Field(..., alias="fileCount")
    ev_total: str = Field(..., alias="evTotal")
    tiles: list[HeatTileData]

    model_config = {"populate_by_name": True}


class AgentPathStep(BaseModel):
    step: int
    tile_id: str = Field(..., alias="tileId")
    action: Literal["read", "retrieved", "edited", "test-failed"]

    model_config = {"populate_by_name": True}


class HeatMapResponse(BaseModel):
    districts: list[HeatDistrict]
    agent_path: list[AgentPathStep] = Field(..., alias="agentPath")
    composite_ev: str = Field(..., alias="compositeEv")
    harness: str
    corpus: str

    model_config = {"populate_by_name": True}


def _tile(
    district: str,
    name: str,
    productivity: HeatLevel = "low",
    pollution: HeatLevel = "low",
    reads: int = 0,
    retrievals: int = 0,
    ev: str = "+0.00",
) -> HeatTileData:
    return HeatTileData(
        id=f"{district}/{name}",
        filename=name,
        productivity=productivity,
        pollution=pollution,
        reads=reads,
        retrievals=retrievals,
        evContribution=ev,
    )


def _mock_response() -> HeatMapResponse:
    """Phase-A fixture — mirrors the Figma 04 Heat-map exploration page,
    variant B (tile grid). 7 districts, the agent's 5-step path crosses
    `03-ideas-startups/` where most of the +EV comes from."""
    ideas = HeatDistrict(
        id="ideas-startups",
        name="03-ideas-startups/",
        fileCount=24,
        evTotal="+0.36",
        tiles=[
            _tile("ideas-startups", "strategy/2026-Q3.md", "high", "low", 47, 12, "+0.09"),
            _tile("ideas-startups", "sources/synthesis-runograph-solver-pivot.md", "high", "low", 38, 11, "+0.08"),
            _tile("ideas-startups", "sources/synthesis-runograph-arch.md", "high", "low", 22, 7, "+0.05"),
            _tile("ideas-startups", "wiki/agent-failure-taxonomy-v1.md", "med", "low", 18, 5, "+0.04"),
            _tile("ideas-startups", "decisions/2026-05-17-runograph-private-alpha.md", "med", "low", 11, 3, "+0.03"),
            _tile("ideas-startups", "decisions/2026-05-16-hybrid-ui.md", "med", "low", 9, 2, "+0.02"),
            _tile("ideas-startups", "sources/chat-runoidea-pivot.md", "med", "med", 14, 2, "+0.01"),
            _tile("ideas-startups", "sources/wireframe-runograph-internal.md", "low", "low", 4, 1, "+0.01"),
            _tile("ideas-startups", "sources/paperclip-vs-runograph.md", "low", "low", 3, 0, "+0.01"),
            _tile("ideas-startups", "wiki/runograph-positioning.md", "low", "low", 2, 0, "+0.00"),
            _tile("ideas-startups", "wiki/competitive-axes.md", "low", "low", 1, 0, "+0.00"),
            _tile("ideas-startups", "decisions/2026-05-19-license-model.md", "low", "low", 1, 0, "+0.00"),
            _tile("ideas-startups", "wiki/multi-agent-orchestration-foreclosure.md", "low", "high", 2, 0, "−0.01"),
            _tile("ideas-startups", "sources/chat-runoidea-q3-redo.md", "low", "med", 1, 0, "−0.01"),
            _tile("ideas-startups", "decisions/2026-05-15-rust-defer.md", "low", "low", 0, 0, "+0.00"),
            _tile("ideas-startups", "sources/old-pivot-thoughts.md", "low", "med", 0, 0, "+0.00"),
            _tile("ideas-startups", "wiki/build-in-public.md", "low", "low", 0, 0, "+0.00"),
            _tile("ideas-startups", "wiki/runograph-app-build-state.md", "low", "low", 0, 0, "+0.00"),
            _tile("ideas-startups", "wiki/runograph-business-model.md", "low", "low", 0, 0, "+0.00"),
            _tile("ideas-startups", "wiki/runograph-distribution.md", "low", "low", 0, 0, "+0.00"),
            _tile("ideas-startups", "wiki/runograph-roadmap.md", "low", "low", 0, 0, "+0.00"),
            _tile("ideas-startups", "wiki/runograph-tech-stack.md", "low", "low", 0, 0, "+0.00"),
            _tile("ideas-startups", "wiki/sample-1.md", "low", "low", 0, 0, "+0.00"),
            _tile("ideas-startups", "wiki/sample-2.md", "low", "low", 0, 0, "+0.00"),
        ],
    )
    learning = HeatDistrict(
        id="learning",
        name="02-learning/",
        fileCount=18,
        evTotal="+0.21",
        tiles=[
            _tile("learning", "wiki/karpathy-llm-wiki.md", "high", "low", 28, 9, "+0.06"),
            _tile("learning", "sources/article-karpathy-llm-gist.md", "high", "low", 22, 7, "+0.05"),
            _tile("learning", "wiki/agent-eval-platforms.md", "med", "low", 14, 4, "+0.04"),
            _tile("learning", "wiki/telemetry-driven-eval.md", "med", "low", 11, 3, "+0.03"),
            _tile("learning", "sources/feed/x-daily-2026-05-06.md", "low", "low", 2, 0, "+0.01"),
            _tile("learning", "wiki/agent-fleet-cost-drivers.md", "low", "low", 1, 0, "+0.01"),
            _tile("learning", "wiki/agent-fleet-remediation.md", "low", "low", 1, 0, "+0.01"),
            _tile("learning", "wiki/agent-fleet-eval.md", "low", "low", 0, 0, "+0.00"),
            _tile("learning", "wiki/sample-3.md", "low", "low", 0, 0, "+0.00"),
            _tile("learning", "wiki/sample-4.md", "low", "low", 0, 0, "+0.00"),
            _tile("learning", "wiki/sample-5.md", "low", "low", 0, 0, "+0.00"),
            _tile("learning", "wiki/sample-6.md", "low", "low", 0, 0, "+0.00"),
            _tile("learning", "wiki/sample-7.md", "low", "low", 0, 0, "+0.00"),
            _tile("learning", "wiki/sample-8.md", "low", "low", 0, 0, "+0.00"),
            _tile("learning", "wiki/sample-9.md", "low", "low", 0, 0, "+0.00"),
            _tile("learning", "wiki/sample-10.md", "low", "low", 0, 0, "+0.00"),
            _tile("learning", "wiki/sample-11.md", "low", "low", 0, 0, "+0.00"),
            _tile("learning", "wiki/sample-12.md", "low", "low", 0, 0, "+0.00"),
        ],
    )
    gym = HeatDistrict(
        id="gym",
        name="01-personal-gym/",
        fileCount=15,
        evTotal="−0.04",
        tiles=[
            _tile("gym", "wiki/hormonal-signal-canon.md", "low", "low", 3, 0, "+0.01"),
            _tile("gym", "sources/article-ecdysteroids.md", "low", "med", 2, 0, "−0.01"),
            _tile("gym", "wiki/vemoherb-protodioscin.md", "low", "med", 1, 0, "−0.01"),
            _tile("gym", "wiki/microneedling-minox.md", "low", "med", 1, 0, "−0.01"),
            _tile("gym", "experiments/citrulline-pomegranate.md", "low", "low", 0, 0, "+0.00"),
            _tile("gym", "experiments/beard-density-12w.md", "low", "low", 0, 0, "+0.00"),
            _tile("gym", "README.md", "low", "low", 0, 0, "+0.00"),
            _tile("gym", "wiki/sample-1.md", "low", "low", 0, 0, "+0.00"),
            _tile("gym", "wiki/sample-2.md", "low", "low", 0, 0, "+0.00"),
            _tile("gym", "wiki/sample-3.md", "low", "low", 0, 0, "+0.00"),
            _tile("gym", "wiki/sample-4.md", "low", "low", 0, 0, "+0.00"),
            _tile("gym", "wiki/sample-5.md", "low", "low", 0, 0, "+0.00"),
            _tile("gym", "wiki/sample-6.md", "low", "low", 0, 0, "+0.00"),
            _tile("gym", "wiki/sample-7.md", "low", "low", 0, 0, "+0.00"),
            _tile("gym", "wiki/sample-8.md", "low", "low", 0, 0, "+0.00"),
        ],
    )
    claude = HeatDistrict(
        id="claude",
        name=".claude/",
        fileCount=12,
        evTotal="−0.02",
        tiles=[
            _tile("claude", "agents/redteam.md", "low", "low", 2, 1, "+0.01"),
            _tile("claude", "agents/sourcer.md", "low", "low", 1, 1, "+0.01"),
            _tile("claude", "commands/digest.md", "low", "med", 2, 0, "−0.01"),
            _tile("claude", "commands/recall.md", "low", "med", 1, 0, "−0.01"),
            _tile("claude", "settings.json", "low", "low", 0, 0, "+0.00"),
            _tile("claude", "settings.local.json", "low", "low", 0, 0, "+0.00"),
            _tile("claude", "agents/sample-1.md", "low", "low", 0, 0, "+0.00"),
            _tile("claude", "agents/sample-2.md", "low", "low", 0, 0, "+0.00"),
            _tile("claude", "commands/sample-1.md", "low", "low", 0, 0, "+0.00"),
            _tile("claude", "commands/sample-2.md", "low", "low", 0, 0, "+0.00"),
            _tile("claude", "hooks/audit_emit.py", "low", "low", 0, 0, "+0.00"),
            _tile("claude", "hooks/sample.py", "low", "low", 0, 0, "+0.00"),
        ],
    )
    meta = HeatDistrict(
        id="meta",
        name="_meta/",
        fileCount=9,
        evTotal="+0.05",
        tiles=[
            _tile("meta", "conventions.md", "med", "low", 6, 2, "+0.02"),
            _tile("meta", "specs/review-tiers.md", "med", "low", 5, 2, "+0.02"),
            _tile("meta", "specs/agent-contracts.md", "low", "low", 2, 1, "+0.01"),
            _tile("meta", "wiki-authoring.md", "low", "low", 1, 0, "+0.00"),
            _tile("meta", "operating-state-convention.md", "low", "low", 1, 0, "+0.00"),
            _tile("meta", "sample-1.md", "low", "low", 0, 0, "+0.00"),
            _tile("meta", "sample-2.md", "low", "low", 0, 0, "+0.00"),
            _tile("meta", "sample-3.md", "low", "low", 0, 0, "+0.00"),
            _tile("meta", "sample-4.md", "low", "low", 0, 0, "+0.00"),
        ],
    )
    career = HeatDistrict(
        id="career",
        name="04-career/",
        fileCount=6,
        evTotal="+0.00",
        tiles=[
            _tile("career", "sample-1.md", "low", "low", 0, 0, "+0.00"),
            _tile("career", "sample-2.md", "low", "low", 0, 0, "+0.00"),
            _tile("career", "sample-3.md", "low", "low", 0, 0, "+0.00"),
            _tile("career", "sample-4.md", "low", "low", 0, 0, "+0.00"),
            _tile("career", "sample-5.md", "low", "low", 0, 0, "+0.00"),
            _tile("career", "sample-6.md", "low", "low", 0, 0, "+0.00"),
        ],
    )
    other = HeatDistrict(
        id="other",
        name="05-other/",
        fileCount=4,
        evTotal="+0.00",
        tiles=[
            _tile("other", "sample-1.md", "low", "low", 0, 0, "+0.00"),
            _tile("other", "sample-2.md", "low", "low", 0, 0, "+0.00"),
            _tile("other", "sample-3.md", "low", "low", 0, 0, "+0.00"),
            _tile("other", "sample-4.md", "low", "low", 0, 0, "+0.00"),
        ],
    )
    return HeatMapResponse(
        districts=[ideas, learning, gym, claude, meta, career, other],
        agentPath=[
            AgentPathStep(step=1, tileId="ideas-startups/wiki/agent-failure-taxonomy-v1.md", action="read"),
            AgentPathStep(step=2, tileId="ideas-startups/sources/synthesis-runograph-solver-pivot.md", action="retrieved"),
            AgentPathStep(step=3, tileId="ideas-startups/strategy/2026-Q3.md", action="retrieved"),
            AgentPathStep(step=4, tileId="ideas-startups/sources/synthesis-runograph-arch.md", action="edited"),
            AgentPathStep(step=5, tileId="ideas-startups/wiki/multi-agent-orchestration-foreclosure.md", action="test-failed"),
        ],
        compositeEv="+0.52",
        harness="Harness B",
        corpus="MasterVaultV1",
    )


@router.get("/heatmap", response_model=HeatMapResponse, response_model_by_alias=True)
async def get_heatmap() -> HeatMapResponse:
    return _mock_response()
