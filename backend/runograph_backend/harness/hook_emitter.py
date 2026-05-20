"""Hook script invoked by Claude Code's PostToolUse / SessionStart hooks.

Reads a JSON payload from stdin (Claude Code hook contract) and appends a
canonical event line to the file at $RUNOGRAPH_EVENTS.

The hook contract per Claude Code 2.1.x: stdin is a JSON object with
`session_id`, `tool_name`, `tool_input`, `tool_response`, `cwd`, etc.

This script is referenced from a `.claude/settings.json` written into each
run's `repo/` working copy by `settings_template.py`. The settings file
points `command` at the absolute path of THIS file under the backend venv's
Python interpreter, so the hook fires cleanly regardless of the working
directory the agent operates in.
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any


_TOOL_TO_EVENT_TYPE: dict[str, str] = {
    "Read": "file_read",
    "Edit": "file_edit",
    "Write": "file_edit",
    "MultiEdit": "file_edit",
    "Bash": "tool_call",
    "Glob": "tool_call",
    "Grep": "tool_call",
    "WebFetch": "tool_call",
    "WebSearch": "tool_call",
    "Task": "reflection",
    "TodoWrite": "reflection",
}


def _extract_target(tool_name: str, tool_input: dict[str, Any]) -> str | None:
    """Pull the most useful field out of the tool input as the route target."""
    if not isinstance(tool_input, dict):
        return None
    for key in ("file_path", "path", "filename"):
        v = tool_input.get(key)
        if isinstance(v, str):
            return v
    if tool_name == "Bash":
        cmd = tool_input.get("command")
        if isinstance(cmd, str):
            return cmd[:200]
    if tool_name in {"Glob", "Grep"}:
        pat = tool_input.get("pattern")
        if isinstance(pat, str):
            return pat
    return None


def _classify_bash(command: str | None) -> str:
    """Refine the event type for Bash invocations — pytest counts as test_run."""
    if not command:
        return "tool_call"
    lowered = command.lower()
    if "pytest" in lowered or lowered.startswith("python -m unittest") or " unittest " in lowered:
        return "test_run"
    return "tool_call"


def _summary(tool_name: str, tool_input: dict[str, Any], tool_response: Any) -> str:
    """Compact human-readable summary of the event."""
    if not isinstance(tool_input, dict):
        tool_input = {}
    parts: list[str] = [tool_name]
    target = _extract_target(tool_name, tool_input)
    if target:
        parts.append(target if len(target) < 120 else target[:117] + "...")
    if isinstance(tool_response, dict):
        if "is_error" in tool_response and tool_response["is_error"]:
            parts.append("ERROR")
    return " · ".join(parts)


def _append_event(events_path: Path, event: dict[str, Any]) -> None:
    events_path.parent.mkdir(parents=True, exist_ok=True)
    with events_path.open("a") as f:
        f.write(json.dumps(event, separators=(",", ":")))
        f.write("\n")


def main() -> int:
    events_path_str = os.environ.get("RUNOGRAPH_EVENTS")
    if not events_path_str:
        # Hook fired outside an experiment — silently no-op so we don't break
        # whatever else might be using the same settings.json.
        return 0
    events_path = Path(events_path_str)

    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        return 0

    tool_name = payload.get("tool_name", "Unknown")
    tool_input = payload.get("tool_input", {}) or {}
    tool_response = payload.get("tool_response")

    event_type = _TOOL_TO_EVENT_TYPE.get(tool_name, "tool_call")
    if tool_name == "Bash":
        event_type = _classify_bash(tool_input.get("command"))

    event = {
        "eventId": str(uuid.uuid4()),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "type": event_type,
        "target": _extract_target(tool_name, tool_input),
        "contentSummary": _summary(tool_name, tool_input, tool_response),
        "cost": {"tokens": 0, "timeSeconds": 0.0},
        "parentEventId": None,
        "taskRelevanceScore": None,
    }

    _append_event(events_path, event)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
