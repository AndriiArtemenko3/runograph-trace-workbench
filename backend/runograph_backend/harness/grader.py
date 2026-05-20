"""Score a finished run by running the task's tests against the modified repo.

v0.3 strategy: lightweight grading — check that the agent's edits produce a
git diff (so we know it tried), then run the SWE-bench test patch and
classify outcome as pass / fail / error.

Full SWE-bench parity (FAIL_TO_PASS + PASS_TO_PASS strict scoring) lands
when we connect the orchestrator to the official `swebench` evaluation
harness — deferred past v0.3 alpha.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


Outcome = Literal["pass", "fail", "error"]


@dataclass
class GradeResult:
    outcome: Outcome
    diff_lines: int
    tests_summary: str


def grade_run(repo_dir: Path) -> GradeResult:
    """Inspect the post-run repo state and produce a lightweight verdict.

    Heuristic for v0.3:
      - If `git diff` is empty → fail (agent gave up without editing).
      - Otherwise → pass (agent produced a candidate patch). Strict
        test-running deferred.

    Returning `pass` here ONLY signals \"the agent did something\" — it
    is NOT a SWE-bench-grade verdict. Stage 3 / Stage 4 visualise routes
    regardless of outcome, so this coarse signal is enough for the
    route-distribution research question.
    """
    try:
        diff = subprocess.run(
            ["git", "-C", str(repo_dir), "diff", "--stat"],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        return GradeResult(outcome="error", diff_lines=0, tests_summary="git diff timed out")

    if diff.returncode != 0:
        return GradeResult(
            outcome="error",
            diff_lines=0,
            tests_summary=f"git diff exit {diff.returncode}: {diff.stderr.strip()[:200]}",
        )

    diff_lines = len([ln for ln in diff.stdout.splitlines() if ln.strip()])
    if diff_lines == 0:
        return GradeResult(
            outcome="fail",
            diff_lines=0,
            tests_summary="no edits detected — agent did not modify repo",
        )

    return GradeResult(
        outcome="pass",
        diff_lines=diff_lines,
        tests_summary=f"{diff_lines} diff lines · strict pytest grading deferred",
    )
