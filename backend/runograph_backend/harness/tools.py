"""Local Python implementations of the agent's tool surface.

The Gemini agent loop calls these via function calling. Each tool:
  - executes locally against the per-run cloned repo,
  - appends one CanonicalEvent to events.jsonl,
  - returns a truncated string result fed back to the model.

Tool names mirror Claude Code's tool surface (Read, Edit, Write, Bash, Glob,
Grep) so events.jsonl is shape-compatible with the existing ingest pipeline
and the type → event_type mapping in storage/schemas.py.

The `finish` tool is the agent's explicit termination signal — the loop in
gemini_runner.py exits when the agent calls it.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from google.genai import types

MAX_TOOL_RESULT_CHARS = 8000
MAX_READ_LINES_DEFAULT = 200
MAX_GREP_MATCHES = 100


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _truncate(text: str, limit: int = MAX_TOOL_RESULT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…[truncated {len(text) - limit} chars]"


class EventLogger:
    """Append-only writer for events.jsonl matching CanonicalEvent schema."""

    def __init__(self, events_path: Path):
        self.events_path = events_path
        self.last_event_id: str | None = None
        self.events_path.parent.mkdir(parents=True, exist_ok=True)
        # Touch the file so resumed runs / readers see it
        self.events_path.touch(exist_ok=True)

    def emit(
        self,
        *,
        event_type: str,
        target: str | None,
        summary: str,
        time_seconds: float,
        tokens: int = 0,
    ) -> str:
        event_id = f"e_{uuid.uuid4().hex[:12]}"
        event = {
            "eventId": event_id,
            "timestamp": _now_iso(),
            "type": event_type,
            "target": target,
            "contentSummary": summary,
            "cost": {"tokens": tokens, "timeSeconds": round(time_seconds, 3)},
            "parentEventId": self.last_event_id,
            "taskRelevanceScore": None,
        }
        with self.events_path.open("a") as f:
            f.write(json.dumps(event, separators=(",", ":")))
            f.write("\n")
        self.last_event_id = event_id
        return event_id


class PathOutsideRepoError(Exception):
    """Raised when the agent tries to access a path outside the per-run repo."""


class ToolSet:
    """Bundled tools the agent calls via function declarations.

    All file paths are resolved relative to `repo_dir` and constrained inside
    it. Bash runs with cwd=repo_dir; absolute paths in shell commands aren't
    blocked (the agent could `cat /etc/hosts`) but the run is sandboxed by
    intent: it's a SWE-bench task fix, nothing else.
    """

    def __init__(
        self,
        *,
        repo_dir: Path,
        logger: EventLogger,
        max_bash_seconds: int = 60,
    ):
        self.repo_dir = repo_dir.resolve()
        self.logger = logger
        self.max_bash_seconds = max_bash_seconds
        self._finished = False
        self._finish_reason: str | None = None

    # ----- internal helpers -----

    def _resolve(self, raw_path: str) -> Path:
        p = Path(raw_path)
        if not p.is_absolute():
            p = self.repo_dir / p
        p = p.resolve()
        # Constrain to repo_dir
        if not str(p).startswith(str(self.repo_dir)):
            raise PathOutsideRepoError(
                f"path {p} escapes repo root {self.repo_dir}"
            )
        return p

    # ----- exposed tools -----

    def read_file(
        self,
        path: str,
        offset: int = 0,
        limit: int = MAX_READ_LINES_DEFAULT,
    ) -> str:
        t0 = time.monotonic()
        try:
            target = self._resolve(path)
            text = target.read_text(errors="replace")
            lines = text.splitlines()
            sliced = lines[offset : offset + limit]
            numbered = "\n".join(
                f"{offset + i + 1:6d}\t{line}" for i, line in enumerate(sliced)
            )
            summary = (
                f"read {len(sliced)} lines of {target.relative_to(self.repo_dir)}"
                f" (offset {offset})"
            )
            self.logger.emit(
                event_type="file_read",
                target=str(target.relative_to(self.repo_dir)),
                summary=summary,
                time_seconds=time.monotonic() - t0,
            )
            return _truncate(numbered)
        except Exception as e:  # noqa: BLE001
            self.logger.emit(
                event_type="error",
                target=path,
                summary=f"read_file ERROR: {e}",
                time_seconds=time.monotonic() - t0,
            )
            return f"ERROR: {e}"

    def edit_file(
        self,
        path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> str:
        t0 = time.monotonic()
        try:
            target = self._resolve(path)
            text = target.read_text()
            if old_string not in text:
                raise ValueError("old_string not found in file")
            if not replace_all and text.count(old_string) > 1:
                raise ValueError(
                    f"old_string appears {text.count(old_string)} times; "
                    "either disambiguate or set replace_all=true"
                )
            new_text = (
                text.replace(old_string, new_string)
                if replace_all
                else text.replace(old_string, new_string, 1)
            )
            target.write_text(new_text)
            summary = (
                f"edited {target.relative_to(self.repo_dir)} "
                f"(-{old_string.count(chr(10)) + 1} / +{new_string.count(chr(10)) + 1} lines"
                f"{', replace_all' if replace_all else ''})"
            )
            self.logger.emit(
                event_type="file_edit",
                target=str(target.relative_to(self.repo_dir)),
                summary=summary,
                time_seconds=time.monotonic() - t0,
            )
            return f"OK: {summary}"
        except Exception as e:  # noqa: BLE001
            self.logger.emit(
                event_type="error",
                target=path,
                summary=f"edit_file ERROR: {e}",
                time_seconds=time.monotonic() - t0,
            )
            return f"ERROR: {e}"

    def write_file(self, path: str, content: str) -> str:
        t0 = time.monotonic()
        try:
            target = self._resolve(path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
            summary = (
                f"wrote {target.relative_to(self.repo_dir)} "
                f"({content.count(chr(10)) + 1} lines, {len(content)} chars)"
            )
            self.logger.emit(
                event_type="file_edit",
                target=str(target.relative_to(self.repo_dir)),
                summary=summary,
                time_seconds=time.monotonic() - t0,
            )
            return f"OK: {summary}"
        except Exception as e:  # noqa: BLE001
            self.logger.emit(
                event_type="error",
                target=path,
                summary=f"write_file ERROR: {e}",
                time_seconds=time.monotonic() - t0,
            )
            return f"ERROR: {e}"

    def bash(self, command: str, timeout_seconds: int | None = None) -> str:
        t0 = time.monotonic()
        cmd_summary = command if len(command) < 200 else command[:197] + "..."
        # Classify pytest/unittest as test_run for downstream metric clarity
        lowered = command.lower()
        evt_type = (
            "test_run"
            if "pytest" in lowered or "unittest" in lowered
            else "tool_call"
        )
        try:
            timeout = min(timeout_seconds or self.max_bash_seconds, 300)
            proc = subprocess.run(
                ["/bin/bash", "-lc", command],
                cwd=str(self.repo_dir),
                capture_output=True,
                text=True,
                timeout=timeout,
                env={**os.environ, "PAGER": "cat"},
            )
            output = (proc.stdout or "") + (
                f"\n--- STDERR ---\n{proc.stderr}" if proc.stderr else ""
            )
            output = _truncate(output)
            summary = (
                f"bash exit={proc.returncode}: {cmd_summary[:120]} "
                f"({len(output)} chars)"
            )
            self.logger.emit(
                event_type=evt_type,
                target=cmd_summary,
                summary=summary,
                time_seconds=time.monotonic() - t0,
            )
            return f"exit code: {proc.returncode}\n{output}"
        except subprocess.TimeoutExpired:
            self.logger.emit(
                event_type="error",
                target=cmd_summary,
                summary=f"bash TIMEOUT after {timeout}s: {cmd_summary[:120]}",
                time_seconds=time.monotonic() - t0,
            )
            return f"ERROR: timeout after {timeout}s"
        except Exception as e:  # noqa: BLE001
            self.logger.emit(
                event_type="error",
                target=cmd_summary,
                summary=f"bash ERROR: {e}",
                time_seconds=time.monotonic() - t0,
            )
            return f"ERROR: {e}"

    def glob(self, pattern: str) -> str:
        t0 = time.monotonic()
        try:
            matches = sorted(self.repo_dir.glob(pattern))
            # Sort by mtime desc so most-recently-touched files surface first
            matches.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            rel = [str(p.relative_to(self.repo_dir)) for p in matches[:MAX_GREP_MATCHES]]
            result = "\n".join(rel) if rel else "(no matches)"
            summary = f"glob '{pattern}' → {len(matches)} matches"
            self.logger.emit(
                event_type="tool_call",
                target=pattern,
                summary=summary,
                time_seconds=time.monotonic() - t0,
            )
            return _truncate(result)
        except Exception as e:  # noqa: BLE001
            self.logger.emit(
                event_type="error",
                target=pattern,
                summary=f"glob ERROR: {e}",
                time_seconds=time.monotonic() - t0,
            )
            return f"ERROR: {e}"

    def grep(
        self,
        pattern: str,
        path: str = ".",
        glob_filter: str | None = None,
    ) -> str:
        t0 = time.monotonic()
        try:
            search_root = self._resolve(path)
            regex = re.compile(pattern)
            hits: list[str] = []
            files_iter = (
                search_root.rglob(glob_filter)
                if glob_filter and search_root.is_dir()
                else (search_root.rglob("*") if search_root.is_dir() else [search_root])
            )
            for f in files_iter:
                if not f.is_file():
                    continue
                if ".git" in f.parts:
                    continue
                try:
                    for i, line in enumerate(f.read_text(errors="replace").splitlines(), 1):
                        if regex.search(line):
                            hits.append(
                                f"{f.relative_to(self.repo_dir)}:{i}: {line[:300]}"
                            )
                            if len(hits) >= MAX_GREP_MATCHES:
                                break
                except (OSError, UnicodeDecodeError):
                    continue
                if len(hits) >= MAX_GREP_MATCHES:
                    break
            result = "\n".join(hits) if hits else "(no matches)"
            summary = (
                f"grep '{pattern[:50]}' in {search_root.relative_to(self.repo_dir)}"
                f" → {len(hits)} hits"
            )
            self.logger.emit(
                event_type="tool_call",
                target=f"grep:{pattern[:80]}",
                summary=summary,
                time_seconds=time.monotonic() - t0,
            )
            return _truncate(result)
        except Exception as e:  # noqa: BLE001
            self.logger.emit(
                event_type="error",
                target=f"grep:{pattern[:80]}",
                summary=f"grep ERROR: {e}",
                time_seconds=time.monotonic() - t0,
            )
            return f"ERROR: {e}"

    def finish(self, reason: str) -> str:
        t0 = time.monotonic()
        self._finished = True
        self._finish_reason = reason
        self.logger.emit(
            event_type="final",
            target=None,
            summary=f"agent finished: {reason[:200]}",
            time_seconds=time.monotonic() - t0,
        )
        return "OK: run terminated"


def build_function_declarations() -> list[types.FunctionDeclaration]:
    """Gemini function declarations matching the ToolSet methods.

    Names use snake_case so they match Python method names directly — the
    dispatcher in gemini_runner.py uses getattr() on these.
    """
    return [
        types.FunctionDeclaration(
            name="read_file",
            description=(
                "Read a text file relative to the repo root. Returns numbered "
                "lines. Use `offset` + `limit` to page through large files."
            ),
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "path": types.Schema(
                        type=types.Type.STRING,
                        description="File path relative to repo root.",
                    ),
                    "offset": types.Schema(
                        type=types.Type.INTEGER,
                        description="Line number to start reading from (0-indexed).",
                    ),
                    "limit": types.Schema(
                        type=types.Type.INTEGER,
                        description=f"Max lines to read (default {MAX_READ_LINES_DEFAULT}).",
                    ),
                },
                required=["path"],
            ),
        ),
        types.FunctionDeclaration(
            name="edit_file",
            description=(
                "Replace `old_string` with `new_string` in a file. Fails if "
                "`old_string` is not unique unless `replace_all` is true. "
                "Include enough surrounding context to make `old_string` "
                "unambiguous."
            ),
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "path": types.Schema(type=types.Type.STRING),
                    "old_string": types.Schema(type=types.Type.STRING),
                    "new_string": types.Schema(type=types.Type.STRING),
                    "replace_all": types.Schema(type=types.Type.BOOLEAN),
                },
                required=["path", "old_string", "new_string"],
            ),
        ),
        types.FunctionDeclaration(
            name="write_file",
            description=(
                "Overwrite a file with new content. Use only for new files or "
                "complete rewrites — prefer edit_file for partial changes."
            ),
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "path": types.Schema(type=types.Type.STRING),
                    "content": types.Schema(type=types.Type.STRING),
                },
                required=["path", "content"],
            ),
        ),
        types.FunctionDeclaration(
            name="bash",
            description=(
                "Run a shell command (cwd = repo root). DO NOT run pytest "
                "yourself — the harness will grade after you finish. Use for "
                "git diff, ls, find, etc."
            ),
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "command": types.Schema(type=types.Type.STRING),
                    "timeout_seconds": types.Schema(
                        type=types.Type.INTEGER,
                        description="Per-call timeout (default 60).",
                    ),
                },
                required=["command"],
            ),
        ),
        types.FunctionDeclaration(
            name="glob",
            description=(
                "List files matching a glob pattern (e.g. '**/*.py'), sorted "
                "by modification time descending."
            ),
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "pattern": types.Schema(type=types.Type.STRING),
                },
                required=["pattern"],
            ),
        ),
        types.FunctionDeclaration(
            name="grep",
            description=(
                "Search for a regex pattern across files. `path` defaults to "
                "repo root; `glob_filter` (e.g. '*.py') narrows the file set."
            ),
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "pattern": types.Schema(type=types.Type.STRING),
                    "path": types.Schema(type=types.Type.STRING),
                    "glob_filter": types.Schema(type=types.Type.STRING),
                },
                required=["pattern"],
            ),
        ),
        types.FunctionDeclaration(
            name="finish",
            description=(
                "Call this when you have finished editing and are ready for "
                "the harness to grade your fix. Provide a one-sentence reason "
                "summarising what you changed and why."
            ),
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "reason": types.Schema(type=types.Type.STRING),
                },
                required=["reason"],
            ),
        ),
    ]
