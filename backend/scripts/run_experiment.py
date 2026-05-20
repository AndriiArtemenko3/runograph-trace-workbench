"""Run N Claude Code invocations against one SWE-bench-Lite task.

Per the locked plan at ~/.claude/plans/let-s-do-claude-first-nested-puppy.md:
- 50 runs × pylint-dev__pylint-7993 × sonnet-4-6 (default)
- Per run: clone repo at base_commit, write hooks-emitting settings.json,
  invoke `claude -p`, grade, ingest into SQLite.
- Resumable: skips runs whose meta.json shows status: complete.
- Pre-flight: `--probe` runs the cheapest auth probe; `--limit N` caps runs.

Usage:
  uv run python -m scripts.run_experiment --probe
  uv run python -m scripts.run_experiment --task pylint-dev__pylint-7993 --limit 1
  uv run python -m scripts.run_experiment --task pylint-dev__pylint-7993 --n 50
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from runograph_backend.harness.claude_runner import CLAUDE_BIN, run_claude
from runograph_backend.harness.grader import grade_run
from runograph_backend.harness.settings_template import write_settings
from runograph_backend.harness.task_loader import clone_task_repo, load_task
from runograph_backend.storage.db import AsyncSessionLocal, init_db
from runograph_backend.storage.ingest import ingest_run


DEFAULT_DATA_DIR = Path.home() / ".runograph" / "runs"
DEFAULT_EXPERIMENT = "runograph-50"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _run_id(experiment: str, idx: int) -> str:
    return f"{experiment}-{idx:04d}"


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def probe_auth() -> int:
    """One cheap call to confirm `claude` is on PATH + sonnet-4-6 is reachable."""
    print(f"pre-flight: claude binary at {CLAUDE_BIN}")
    cmd = [CLAUDE_BIN, "-p", "Reply with the single word OK", "--model", "claude-sonnet-4-6", "--output-format", "json"]
    print("pre-flight: running", " ".join(cmd))
    t0 = time.monotonic()
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    elapsed = time.monotonic() - t0
    if res.returncode != 0:
        print(f"pre-flight FAILED in {elapsed:.1f}s (exit {res.returncode}):\nstderr: {res.stderr[:500]}")
        return res.returncode
    try:
        payload = json.loads(res.stdout)
    except json.JSONDecodeError:
        print(f"pre-flight: unexpected stdout (non-JSON): {res.stdout[:200]}")
        return 2
    reply = (payload.get("result") or "").strip()
    cost = float(payload.get("total_cost_usd") or 0.0)
    print(f"pre-flight OK in {elapsed:.1f}s — model replied {reply!r} — cost ${cost:.4f}")
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
    timeout_seconds: int,
) -> dict[str, Any]:
    """Execute a single run end-to-end. Returns the meta.json payload."""
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
    settings_path = write_settings(repo_dir)

    prompt = (
        f"You're fixing a bug in this Python repo (already checked out at "
        f"the buggy commit). The problem statement follows verbatim — read "
        f"the code, edit the file(s) that need fixing, and make sure your "
        f"patch is consistent with the existing style.\n\n"
        f"--- BUG REPORT ---\n{task.problem_statement}\n--- END ---\n\n"
        f"Do not run pytest yourself — the harness will grade after you finish. "
        f"Stop as soon as you've made the edits."
    )

    print(f"[{run_id}] launching claude (model={model}, timeout={timeout_seconds}s)")
    t0 = time.monotonic()
    result = run_claude(
        repo_dir=repo_dir,
        prompt=prompt,
        events_path=events_path,
        stream_path=stream_path,
        model=model,
        timeout_seconds=timeout_seconds,
    )
    elapsed = time.monotonic() - t0
    print(
        f"[{run_id}] claude exited rc={result.return_code} in {elapsed:.1f}s · "
        f"{result.total_tokens} tokens · ${result.total_cost_usd:.4f}"
    )

    grade = grade_run(repo_dir)
    print(f"[{run_id}] grade: outcome={grade.outcome} · {grade.tests_summary}")

    ended_at = _now_iso()
    meta = {
        "runId": run_id,
        "taskId": task.instance_id,
        "model": model,
        "startedAt": started_at,
        "endedAt": ended_at,
        "outcome": grade.outcome if result.return_code == 0 else "error",
        "totalTokens": result.total_tokens,
        "totalCostUsd": result.total_cost_usd,
        "experimentId": experiment_id,
        "settingsHash": None,
        "status": "complete",
        "claudeReturnCode": result.return_code,
        "claudeFinalText": result.final_text[:1000],
        "diffLines": grade.diff_lines,
        "settingsPath": str(settings_path),
    }
    _write_json(meta_path, meta)

    print(f"[{run_id}] ingesting into SQLite …")
    run_id_back, events_ingested = asyncio.run(_ingest(run_dir))
    print(f"[{run_id}] ingested {events_ingested} events")

    return meta


def execute_experiment(
    *,
    task_instance_id: str,
    n_runs: int,
    experiment_id: str,
    model: str,
    data_dir: Path,
    timeout_seconds: int,
) -> dict[str, Any]:
    """Run n_runs end-to-end. Resumable: skips runs with status:complete."""
    exp_dir = data_dir / experiment_id
    runs_dir = exp_dir / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = exp_dir / "manifest.json"

    if manifest_path.exists():
        manifest = _read_json(manifest_path)
    else:
        manifest = {
            "experimentId": experiment_id,
            "task": task_instance_id,
            "model": model,
            "createdAt": _now_iso(),
            "targetRuns": n_runs,
            "runs": [],
        }
        _write_json(manifest_path, manifest)

    completed_ids: set[str] = set()
    for entry in manifest["runs"]:
        if entry.get("status") == "complete":
            completed_ids.add(entry["runId"])

    total_cost = sum(float(e.get("totalCostUsd") or 0) for e in manifest["runs"])
    total_tokens = sum(int(e.get("totalTokens") or 0) for e in manifest["runs"])

    for idx in range(1, n_runs + 1):
        run_id = _run_id(experiment_id, idx)
        run_dir = runs_dir / run_id
        if run_id in completed_ids:
            print(f"[{run_id}] already complete · skipping")
            continue

        if run_dir.exists():
            shutil.rmtree(run_dir)

        try:
            meta = execute_one_run(
                run_dir=run_dir,
                task_instance_id=task_instance_id,
                experiment_id=experiment_id,
                model=model,
                timeout_seconds=timeout_seconds,
            )
        except Exception as e:  # noqa: BLE001 — orchestrator must keep going
            print(f"[{run_id}] EXCEPTION: {e!r}")
            meta = {
                "runId": run_id,
                "taskId": task_instance_id,
                "model": model,
                "experimentId": experiment_id,
                "status": "error",
                "errorMessage": repr(e)[:500],
                "totalTokens": 0,
                "totalCostUsd": 0.0,
            }
            _write_json(run_dir / "meta.json", meta)

        manifest["runs"].append(meta)
        total_cost += float(meta.get("totalCostUsd") or 0)
        total_tokens += int(meta.get("totalTokens") or 0)
        manifest["spend"] = {"totalCostUsd": total_cost, "totalTokens": total_tokens}
        manifest["updatedAt"] = _now_iso()
        _write_json(manifest_path, manifest)
        print(
            f"manifest updated · {len(manifest['runs'])}/{manifest['targetRuns']} runs · "
            f"running total ${total_cost:.3f} / {total_tokens} tokens"
        )

    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the 50-run Claude Code experiment.")
    parser.add_argument("--probe", action="store_true", help="Cheap auth probe only — no full run")
    parser.add_argument("--task", default="pylint-dev__pylint-7993")
    parser.add_argument("--experiment", default=DEFAULT_EXPERIMENT)
    parser.add_argument("--model", default="claude-sonnet-4-6")
    parser.add_argument("--n", type=int, default=50, help="Target run count")
    parser.add_argument("--limit", type=int, default=None, help="Cap actual runs (for dry-run smoke)")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--timeout", type=int, default=600, help="Per-run timeout (seconds)")
    args = parser.parse_args()

    if args.probe:
        return probe_auth()

    n = args.limit if args.limit is not None else args.n
    print(
        f"experiment: {args.experiment} · task: {args.task} · model: {args.model} · "
        f"target runs: {n} · data dir: {args.data_dir}"
    )

    execute_experiment(
        task_instance_id=args.task,
        n_runs=n,
        experiment_id=args.experiment,
        model=args.model,
        data_dir=args.data_dir,
        timeout_seconds=args.timeout,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
