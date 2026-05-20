"""Spawn `claude` as a subprocess against a cloned task repo.

Captures stream-json output to `stream.jsonl`, and (via the hook_emitter
script) ground-truth tool events to `events.jsonl`.

Per the Phase-1 exploration: stream-json carries LLM narrative + token
counts; PostToolUse hooks carry the actual tool arguments (Read paths,
Edit patches, Bash commands). We need both.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path


CLAUDE_BIN = shutil.which("claude") or "claude"


@dataclass
class RunnerResult:
    return_code: int
    duration_seconds: float
    total_tokens: int
    total_cost_usd: float
    final_text: str


def run_claude(
    *,
    repo_dir: Path,
    prompt: str,
    events_path: Path,
    stream_path: Path,
    model: str = "claude-sonnet-4-6",
    allowed_tools: str = "Read,Edit,Write,Bash,Glob,Grep",
    timeout_seconds: int = 600,
    extra_env: dict[str, str] | None = None,
) -> RunnerResult:
    """Invoke `claude -p ...` synchronously and capture both event streams.

    `events_path` is exported as $RUNOGRAPH_EVENTS so the PostToolUse hooks
    in repo_dir/.claude/settings.json append to it.
    `stream_path` receives the raw stream-json stdout.
    """
    env = dict(os.environ)
    env["RUNOGRAPH_EVENTS"] = str(events_path)
    if extra_env:
        env.update(extra_env)

    events_path.parent.mkdir(parents=True, exist_ok=True)
    stream_path.parent.mkdir(parents=True, exist_ok=True)
    # Pre-create events.jsonl so the hook command can always open it for append
    events_path.touch(exist_ok=True)

    cmd = [
        CLAUDE_BIN,
        "-p",
        prompt,
        "--model",
        model,
        "--add-dir",
        str(repo_dir),
        "--allowedTools",
        allowed_tools,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode",
        "bypassPermissions",
    ]

    start = time.monotonic()
    try:
        with stream_path.open("w") as out:
            proc = subprocess.run(
                cmd,
                stdin=subprocess.DEVNULL,
                stdout=out,
                stderr=subprocess.PIPE,
                env=env,
                cwd=str(repo_dir),
                timeout=timeout_seconds,
                text=False,
            )
    except subprocess.TimeoutExpired:
        return RunnerResult(
            return_code=124,
            duration_seconds=time.monotonic() - start,
            total_tokens=0,
            total_cost_usd=0.0,
            final_text="<timeout>",
        )

    duration = time.monotonic() - start

    total_tokens, total_cost_usd, final_text = _aggregate_stream(stream_path)
    return RunnerResult(
        return_code=proc.returncode,
        duration_seconds=duration,
        total_tokens=total_tokens,
        total_cost_usd=total_cost_usd,
        final_text=final_text,
    )


def _aggregate_stream(stream_path: Path) -> tuple[int, float, str]:
    """Walk the stream.jsonl and sum tokens / cost; pull the final 'result' event."""
    total_tokens = 0
    total_cost_usd = 0.0
    final_text = ""
    if not stream_path.exists():
        return total_tokens, total_cost_usd, final_text

    with stream_path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            # Per Claude Code stream-json contract: terminal "result" event carries
            # cumulative usage + cost.
            if obj.get("type") == "result":
                total_cost_usd = float(obj.get("total_cost_usd") or 0.0)
                usage = obj.get("usage") or {}
                total_tokens = int(
                    (usage.get("input_tokens") or 0)
                    + (usage.get("output_tokens") or 0)
                    + (usage.get("cache_creation_input_tokens") or 0)
                    + (usage.get("cache_read_input_tokens") or 0)
                )
                final_text = str(obj.get("result") or "")
    return total_tokens, total_cost_usd, final_text
