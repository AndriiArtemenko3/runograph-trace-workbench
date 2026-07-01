"""Run N Gemini-agent invocations against one SWE-bench-Lite task.

Architecture pivoted 2026-05-20 from Claude Code subprocess (blocked by
subscription auth wall) to native Gemini API + local function-calling loop.

Per the locked plan at ~/.claude/plans/let-s-do-claude-first-nested-puppy.md:
- 50 runs × pylint-dev__pylint-7993 × gemini-2.5-pro (production)
- gemini-2.5-flash for dry-run verification (~10× cheaper)
- Per run: clone repo at base_commit, run agent loop, grade, ingest into SQLite.
- Resumable: skips runs whose meta.json shows status: complete.
- --probe: cheapest auth probe; --limit N caps runs; --parallel N concurrency.

Usage:
  uv run python -m scripts.run_experiment --probe
  uv run python -m scripts.run_experiment --task pylint-dev__pylint-7993 --model gemini-2.5-flash --limit 1
  uv run python -m scripts.run_experiment --task pylint-dev__pylint-7993 --model gemini-2.5-pro --n 50 --parallel 5
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from runograph_backend.harness.gemini_runner import (
    PRICING_PER_MTOK,
    RunnerResult,
    probe,
    run_gemini,
)
from runograph_backend.harness.grader import grade_run
from runograph_backend.harness.task_loader import clone_task_repo, load_task
from runograph_backend.storage.db import AsyncSessionLocal, init_db
from runograph_backend.storage.ingest import ingest_run

DEFAULT_DATA_DIR = Path.home() / ".runograph" / "runs"
DEFAULT_EXPERIMENT = "runograph-50"
DEFAULT_MODEL = "gemini-2.5-flash"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _run_id(experiment: str, idx: int) -> str:
    return f"{experiment}-{idx:04d}"


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def probe_auth(model: str) -> int:
    """Cheap one-shot probe — confirms API key + model are reachable."""
    print(f"pre-flight: probing {model} …")
    result = probe(model)
    if not result.success:
        print(f"pre-flight FAILED in {result.duration_seconds:.1f}s: {result.error}")
        return 1
    print(
        f"pre-flight OK in {result.duration_seconds:.1f}s · "
        f"model replied {result.final_text!r} · "
        f"{result.total_tokens} tokens · ${result.total_cost_usd:.5f}"
    )
    return 0


async def _ingest(run_dir: Path) -> tuple[str, int]:
    await init_db()
    async with AsyncSessionLocal() as session:
        return await ingest_run(session, run_dir)


def execute_one_run(
    *,
    run_dir: Path,
    task_instance_id: str,
    experiment_id: str,
    model: str,
    max_turns: int,
    timeout_seconds: int,
    perturbations: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute a single run end-to-end. Returns the meta.json payload.

    `perturbations` (optional dict): synthetic interventions applied at
    grading time. Supported keys:
      outcome_override: "pass" | "fail" | "error" — forces final outcome
        regardless of grade result. Used by the bug-injection experiment
        (see 03-ideas-startups/decisions/2026-05-23-aggregate-map-bug-
        injection-experiment.md) to test visualization responsiveness.

    Future keys (not yet wired): edge_weight_noise, node_visit_anomalies.
    """
    run_dir.mkdir(parents=True, exist_ok=True)
    events_path = run_dir / "events.jsonl"
    stream_path = run_dir / "stream.jsonl"
    meta_path = run_dir / "meta.json"
    run_id = run_dir.name

    started_at = _now_iso()
    print(f"[{run_id}] loading task {task_instance_id} …")
    task = load_task(task_instance_id)

    print(f"[{run_id}] cloning {task.repo} @ {task.base_commit[:10]}")
    repo_dir = clone_task_repo(task, run_dir)

    print(f"[{run_id}] launching gemini (model={model}, max_turns={max_turns})")
    result: RunnerResult = run_gemini(
        repo_dir=repo_dir,
        problem_statement=task.problem_statement,
        events_path=events_path,
        stream_path=stream_path,
        model=model,
        max_turns=max_turns,
        max_bash_seconds=timeout_seconds,
    )

    print(
        f"[{run_id}] gemini finished in {result.duration_seconds:.1f}s · "
        f"turns={result.turn_count} · tool_calls={result.function_call_count} · "
        f"{result.total_tokens} tok · ${result.total_cost_usd:.5f}"
        + (f" · ERROR={result.error}" if result.error else "")
    )

    grade = grade_run(repo_dir)
    print(f"[{run_id}] grade: outcome={grade.outcome} · {grade.tests_summary}")

    natural_outcome = grade.outcome if result.success else "error"
    perturbed_outcome: str | None = None
    if perturbations and (override := perturbations.get("outcome_override")):
        if override in ("pass", "fail", "error"):
            perturbed_outcome = override
            print(f"[{run_id}] PERTURBATION: outcome_override {natural_outcome} -> {override}")

    ended_at = _now_iso()
    meta = {
        "runId": run_id,
        "taskId": task.instance_id,
        "model": model,
        "startedAt": started_at,
        "endedAt": ended_at,
        "outcome": perturbed_outcome or natural_outcome,
        "naturalOutcome": natural_outcome,
        "perturbed": bool(perturbed_outcome),
        "perturbations": perturbations or {},
        "totalTokens": result.total_tokens,
        "totalCostUsd": result.total_cost_usd,
        "experimentId": experiment_id,
        "settingsHash": None,
        "status": "complete",
        "agentSuccess": result.success,
        "finishedViaTool": result.finished_via_tool,
        "finishReason": result.finish_reason,
        "turnCount": result.turn_count,
        "functionCallCount": result.function_call_count,
        "inputTokens": result.total_input_tokens,
        "outputTokens": result.total_output_tokens,
        "thoughtsTokens": result.total_thoughts_tokens,
        "agentError": result.error,
        "finalText": result.final_text[:1000],
        "diffLines": grade.diff_lines,
    }
    _write_json(meta_path, meta)

    print(f"[{run_id}] ingesting into SQLite …")
    run_id_back, events_ingested = asyncio.run(_ingest(run_dir))
    print(f"[{run_id}] ingested {events_ingested} events")

    return meta


def _execute_one_safe(**kwargs) -> dict[str, Any]:
    """Wrap execute_one_run for parallel use; catches exceptions per-run."""
    run_dir = kwargs["run_dir"]
    run_id = run_dir.name
    try:
        return execute_one_run(**kwargs)
    except Exception as e:  # noqa: BLE001
        print(f"[{run_id}] EXCEPTION: {e!r}")
        meta = {
            "runId": run_id,
            "taskId": kwargs["task_instance_id"],
            "model": kwargs["model"],
            "experimentId": kwargs["experiment_id"],
            "status": "error",
            "errorMessage": repr(e)[:500],
            "totalTokens": 0,
            "totalCostUsd": 0.0,
        }
        _write_json(run_dir / "meta.json", meta)
        return meta


def execute_experiment(
    *,
    task_instance_id: str,
    n_runs: int,
    experiment_id: str,
    model: str,
    data_dir: Path,
    timeout_seconds: int,
    max_turns: int,
    parallel: int,
    perturbations: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run n_runs end-to-end. Resumable: skips runs with status:complete.

    `perturbations` (optional): applied to every run in this experiment
    invocation. Recorded in the manifest so bug-injection experiments can
    reconstruct A → A' → A baseline conditions by comparing manifests.
    """
    exp_dir = data_dir / experiment_id
    runs_dir = exp_dir / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = exp_dir / "manifest.json"

    if manifest_path.exists():
        manifest = _read_json(manifest_path)
        # Record perturbations applied on THIS invocation, even on resumed runs.
        if perturbations:
            manifest.setdefault("perturbationLog", []).append(
                {"ts": _now_iso(), "perturbations": perturbations}
            )
    else:
        manifest = {
            "experimentId": experiment_id,
            "task": task_instance_id,
            "model": model,
            "createdAt": _now_iso(),
            "targetRuns": n_runs,
            "perturbations": perturbations or {},
            "perturbationLog": (
                [{"ts": _now_iso(), "perturbations": perturbations}] if perturbations else []
            ),
            "runs": [],
        }
        _write_json(manifest_path, manifest)

    completed_ids: set[str] = set()
    for entry in manifest["runs"]:
        if entry.get("status") == "complete":
            completed_ids.add(entry["runId"])

    total_cost = sum(float(e.get("totalCostUsd") or 0) for e in manifest["runs"])
    total_tokens = sum(int(e.get("totalTokens") or 0) for e in manifest["runs"])

    # Build the list of run-jobs that still need work
    pending: list[dict[str, Any]] = []
    for idx in range(1, n_runs + 1):
        run_id = _run_id(experiment_id, idx)
        run_dir = runs_dir / run_id
        if run_id in completed_ids:
            print(f"[{run_id}] already complete · skipping")
            continue
        if run_dir.exists():
            shutil.rmtree(run_dir)
        pending.append(
            {
                "run_dir": run_dir,
                "task_instance_id": task_instance_id,
                "experiment_id": experiment_id,
                "model": model,
                "max_turns": max_turns,
                "timeout_seconds": timeout_seconds,
                "perturbations": perturbations,
            }
        )

    def _record_meta(meta: dict[str, Any]) -> None:
        nonlocal total_cost, total_tokens
        manifest["runs"].append(meta)
        total_cost += float(meta.get("totalCostUsd") or 0)
        total_tokens += int(meta.get("totalTokens") or 0)
        manifest["spend"] = {"totalCostUsd": total_cost, "totalTokens": total_tokens}
        manifest["updatedAt"] = _now_iso()
        _write_json(manifest_path, manifest)
        print(
            f"manifest · {len(manifest['runs'])}/{manifest['targetRuns']} runs · "
            f"running total ${total_cost:.4f} / {total_tokens} tok"
        )

    if parallel <= 1:
        for kwargs in pending:
            _record_meta(_execute_one_safe(**kwargs))
    else:
        # Parallel execution. Each run clones its own repo dir, so isolated.
        # Gemini API calls are I/O-bound — threads are fine.
        with ThreadPoolExecutor(max_workers=parallel) as pool:
            futures = {pool.submit(_execute_one_safe, **kwargs): kwargs for kwargs in pending}
            for fut in as_completed(futures):
                _record_meta(fut.result())

    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the 50-run Gemini-agent experiment.")
    parser.add_argument("--probe", action="store_true", help="Cheap auth probe only — no full run")
    parser.add_argument("--task", default="pylint-dev__pylint-7993")
    parser.add_argument("--experiment", default=DEFAULT_EXPERIMENT)
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Gemini model (default {DEFAULT_MODEL}). Known: {', '.join(PRICING_PER_MTOK)}",
    )
    parser.add_argument("--n", type=int, default=50, help="Target run count")
    parser.add_argument("--limit", type=int, default=None, help="Cap actual runs (for dry-run smoke)")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--timeout", type=int, default=120, help="Per-bash-call timeout (seconds)")
    parser.add_argument("--max-turns", type=int, default=40, help="Cap on agent loop turns per run")
    parser.add_argument("--parallel", type=int, default=1, help="Concurrent runs (default 1)")
    parser.add_argument(
        "--perturbations",
        type=Path,
        default=None,
        help=(
            "Path to a JSON file describing perturbations applied to every run. "
            "Schema: {\"outcome_override\": \"pass\"|\"fail\"|\"error\"}. "
            "Used by the aggregate-map bug-injection experiment "
            "(03-ideas-startups/decisions/2026-05-23-aggregate-map-bug-injection-experiment.md)."
        ),
    )
    args = parser.parse_args()

    perturbations: dict[str, Any] | None = None
    if args.perturbations:
        if not args.perturbations.exists():
            print(f"--perturbations file not found: {args.perturbations}")
            return 1
        perturbations = json.loads(args.perturbations.read_text())
        print(f"loaded perturbations: {perturbations}")

    if args.probe:
        return probe_auth(args.model)

    n = args.limit if args.limit is not None else args.n
    print(
        f"experiment: {args.experiment} · task: {args.task} · model: {args.model} · "
        f"target runs: {n} · parallel: {args.parallel} · data dir: {args.data_dir}"
    )

    t0 = time.monotonic()
    execute_experiment(
        task_instance_id=args.task,
        n_runs=n,
        experiment_id=args.experiment,
        model=args.model,
        data_dir=args.data_dir,
        timeout_seconds=args.timeout,
        max_turns=args.max_turns,
        parallel=args.parallel,
        perturbations=perturbations,
    )
    print(f"experiment complete in {time.monotonic() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
