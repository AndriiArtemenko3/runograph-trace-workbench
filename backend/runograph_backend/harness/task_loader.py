"""SWE-bench-Lite task loader.

Loads one task spec from the HuggingFace `princeton-nlp/SWE-bench_Lite`
dataset and clones the underlying repo at the task's base commit into a
per-run directory.

The dataset is cached locally after first download (~50 MB).
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class TaskSpec:
    instance_id: str
    repo: str
    base_commit: str
    problem_statement: str
    test_patch: str
    fail_to_pass: list[str]
    pass_to_pass: list[str]


def load_task(instance_id: str) -> TaskSpec:
    """Load one task by instance_id from princeton-nlp/SWE-bench_Lite.

    Requires `datasets` (HuggingFace) installed. The lib downloads + caches
    the bench data on first use.
    """
    from datasets import load_dataset  # local import — heavy dep

    ds = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")
    matches = [row for row in ds if row["instance_id"] == instance_id]
    if not matches:
        raise ValueError(f"task {instance_id} not found in SWE-bench-Lite")
    row = matches[0]

    def _parse_list(field: str) -> list[str]:
        v = row.get(field, "[]")
        if isinstance(v, list):
            return v
        # SWE-bench stores these as JSON-encoded strings in some snapshots
        import json
        try:
            parsed = json.loads(v)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []

    return TaskSpec(
        instance_id=row["instance_id"],
        repo=row["repo"],
        base_commit=row["base_commit"],
        problem_statement=row["problem_statement"],
        test_patch=row.get("test_patch", ""),
        fail_to_pass=_parse_list("FAIL_TO_PASS"),
        pass_to_pass=_parse_list("PASS_TO_PASS"),
    )


def clone_task_repo(task: TaskSpec, dest: Path) -> Path:
    """Clone the task's repo into `dest/repo`, check out `base_commit`."""
    repo_dir = dest / "repo"
    if repo_dir.exists():
        raise FileExistsError(f"repo already exists at {repo_dir}")

    repo_url = f"https://github.com/{task.repo}.git"
    subprocess.run(
        ["git", "clone", "--quiet", repo_url, str(repo_dir)],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "-C", str(repo_dir), "checkout", "--quiet", task.base_commit],
        check=True,
        capture_output=True,
    )
    return repo_dir
