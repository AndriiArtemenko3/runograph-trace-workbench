"""Generate the per-run `.claude/settings.json` that wires PostToolUse +
SessionStart hooks at the hook_emitter script.

The hook_emitter writes one event line per tool call to the file at
$RUNOGRAPH_EVENTS — which the orchestrator sets per run before invoking
`claude code` as a subprocess.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from . import hook_emitter


def render_settings_json() -> dict:
    """Build the settings.json structure pointing PostToolUse at hook_emitter."""
    python_exe = sys.executable
    emitter_path = Path(hook_emitter.__file__).resolve()
    cmd = f"{python_exe} {emitter_path}"
    return {
        "hooks": {
            "PostToolUse": [
                {
                    "matcher": "*",
                    "hooks": [
                        {
                            "type": "command",
                            "command": cmd,
                        }
                    ],
                }
            ],
        }
    }


def write_settings(repo_dir: Path) -> Path:
    """Write `.claude/settings.json` inside the cloned repo. Returns the path."""
    settings_dir = repo_dir / ".claude"
    settings_dir.mkdir(parents=True, exist_ok=True)
    settings_path = settings_dir / "settings.json"
    settings_path.write_text(json.dumps(render_settings_json(), indent=2))
    return settings_path
