"""Run one SWE-bench task against a Gemini model with native function calling.

Architecture:
  1. Build a ToolSet bound to the per-run repo + events.jsonl logger.
  2. Build FunctionDeclarations matching the ToolSet methods.
  3. Loop generate_content() turns:
       - send conversation history + tools
       - dispatch any function_calls in the response to the ToolSet
       - append both the model turn and the function responses to history
       - exit on tool 'finish' OR max_turns OR no function calls in turn
  4. Aggregate tokens, compute cost, return RunnerResult.

The PROMPT below frames the task as: read the bug report, edit files to fix
it, call `finish` when done. The harness grades after we return — the agent
is instructed not to run pytest itself (matches the original Claude prompt).
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

from google import genai
from google.genai import types

from .tools import EventLogger, ToolSet, build_function_declarations

# Per-million-token USD prices. Verify against https://ai.google.dev/pricing
# before drawing budget conclusions. Updated 2026-01.
PRICING_PER_MTOK: dict[str, dict[str, float]] = {
    "gemini-2.5-flash": {"input": 0.075, "output": 0.30},
    "gemini-2.5-flash-lite": {"input": 0.0375, "output": 0.15},
    "gemini-2.5-pro": {"input": 1.25, "output": 5.00},
}

DEFAULT_MAX_TURNS = 40

SYSTEM_INSTRUCTION = """\
You are an autonomous coding agent fixing a bug in a Python repository that \
has already been checked out at the buggy commit. Your task is described in \
the user message verbatim from a real GitHub issue.

Use the provided tools to:
  1. Read the relevant source files and understand the failure mode.
  2. Make targeted edits to the file(s) that need fixing. Keep changes \
minimal and consistent with the existing style.
  3. Call `finish(reason)` when you are done editing.

Important constraints:
  - DO NOT run pytest or the project's tests yourself. The harness will \
grade automatically after you finish.
  - Stay inside the repo. All paths are relative to the repo root.
  - Prefer `edit_file` for surgical changes; reserve `write_file` for new \
files or full rewrites.
  - When you call `edit_file`, include enough surrounding context in \
`old_string` so the match is unambiguous.
  - The repo state when you start has the bug present. Your job is to \
remove the bug.
"""


@dataclass
class RunnerResult:
    success: bool
    duration_seconds: float
    total_input_tokens: int
    total_output_tokens: int
    total_thoughts_tokens: int
    total_tokens: int
    total_cost_usd: float
    turn_count: int
    finished_via_tool: bool
    finish_reason: str | None
    final_text: str
    error: str | None = None
    function_call_count: int = 0
    per_turn_usage: list[dict] = field(default_factory=list)


def _estimate_cost_usd(
    model: str,
    input_tokens: int,
    output_tokens: int,
) -> float:
    price = PRICING_PER_MTOK.get(model)
    if not price:
        return 0.0
    return (input_tokens / 1_000_000) * price["input"] + (
        output_tokens / 1_000_000
    ) * price["output"]


def _build_user_prompt(problem_statement: str) -> str:
    return (
        "Fix the bug described below. The repository is already checked out "
        "at the buggy commit; you are working in the repo root.\n\n"
        f"--- BUG REPORT ---\n{problem_statement}\n--- END ---\n\n"
        "Read the code, make the minimal fix, then call `finish` with a "
        "one-sentence summary."
    )


def run_gemini(
    *,
    repo_dir: Path,
    problem_statement: str,
    events_path: Path,
    stream_path: Path,
    model: str,
    max_turns: int = DEFAULT_MAX_TURNS,
    max_bash_seconds: int = 60,
    api_key: str | None = None,
) -> RunnerResult:
    """Run one Gemini agent loop end-to-end. Returns aggregated result.

    `stream_path` captures one JSON line per turn with usage + function calls
    so we have a per-turn audit trail equivalent to Claude's stream-json.
    """
    t0 = time.monotonic()
    key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get(
        "GOOGLE_API_KEY"
    )
    if not key:
        return RunnerResult(
            success=False,
            duration_seconds=0.0,
            total_input_tokens=0,
            total_output_tokens=0,
            total_thoughts_tokens=0,
            total_tokens=0,
            total_cost_usd=0.0,
            turn_count=0,
            finished_via_tool=False,
            finish_reason=None,
            final_text="",
            error="GEMINI_API_KEY not set",
        )

    client = genai.Client(api_key=key)
    logger = EventLogger(events_path)
    tools = ToolSet(repo_dir=repo_dir, logger=logger, max_bash_seconds=max_bash_seconds)
    declarations = build_function_declarations()

    contents: list[types.Content] = [
        types.Content(
            role="user",
            parts=[types.Part.from_text(text=_build_user_prompt(problem_statement))],
        )
    ]

    stream_path.parent.mkdir(parents=True, exist_ok=True)
    stream_f = stream_path.open("w")

    total_input = 0
    total_output = 0
    total_thoughts = 0
    function_call_count = 0
    final_text = ""
    error: str | None = None
    per_turn_usage: list[dict] = []

    config = types.GenerateContentConfig(
        tools=[types.Tool(function_declarations=declarations)],
        system_instruction=SYSTEM_INSTRUCTION,
        # Force the model to either return text OR a function call, not both
        # mixed — keeps the dispatch loop simple.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )

    turn = 0
    try:
        while turn < max_turns:
            turn += 1
            response = client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )

            usage = response.usage_metadata
            in_tok = usage.prompt_token_count or 0 if usage else 0
            out_tok = usage.candidates_token_count or 0 if usage else 0
            thoughts_tok = (
                getattr(usage, "thoughts_token_count", None) or 0 if usage else 0
            )
            total_input += in_tok
            total_output += out_tok + thoughts_tok
            total_thoughts += thoughts_tok

            candidate = response.candidates[0] if response.candidates else None
            if not candidate or not candidate.content:
                error = "model returned no candidate content"
                break

            # Append the model's turn to conversation history
            contents.append(candidate.content)

            # Extract function calls and any text
            function_calls: list[types.FunctionCall] = []
            turn_text_parts: list[str] = []
            for part in candidate.content.parts or []:
                if part.function_call:
                    function_calls.append(part.function_call)
                elif part.text:
                    turn_text_parts.append(part.text)
            turn_text = "".join(turn_text_parts)

            # Persist per-turn audit line (equivalent to stream-json)
            turn_record = {
                "turn": turn,
                "inputTokens": in_tok,
                "outputTokens": out_tok,
                "thoughtsTokens": thoughts_tok,
                "functionCalls": [
                    {"name": fc.name, "args": dict(fc.args or {})}
                    for fc in function_calls
                ],
                "text": turn_text[:500],
                "finishReason": str(candidate.finish_reason)
                if candidate.finish_reason
                else None,
            }
            per_turn_usage.append(turn_record)
            stream_f.write(json.dumps(turn_record, separators=(",", ":")) + "\n")
            stream_f.flush()

            if not function_calls:
                # Model returned text without calling any tools — treat as done
                final_text = turn_text
                break

            # Dispatch each function call
            function_responses: list[types.Part] = []
            for fc in function_calls:
                function_call_count += 1
                method = getattr(tools, fc.name, None)
                if method is None:
                    result_str = f"ERROR: unknown tool {fc.name}"
                else:
                    try:
                        result_str = method(**(fc.args or {}))
                    except Exception as e:  # noqa: BLE001
                        result_str = f"ERROR: {type(e).__name__}: {e}"
                function_responses.append(
                    types.Part.from_function_response(
                        name=fc.name,
                        response={"result": result_str},
                    )
                )

            # Append tool results back to the conversation
            contents.append(types.Content(role="user", parts=function_responses))

            if tools._finished:
                final_text = tools._finish_reason or ""
                break
        else:
            error = f"max_turns ({max_turns}) reached without `finish`"
    except Exception as e:  # noqa: BLE001
        error = f"{type(e).__name__}: {e}"
    finally:
        stream_f.close()

    duration = time.monotonic() - t0
    total_all = total_input + total_output
    cost = _estimate_cost_usd(model, total_input, total_output)

    return RunnerResult(
        success=error is None,
        duration_seconds=duration,
        total_input_tokens=total_input,
        total_output_tokens=total_output,
        total_thoughts_tokens=total_thoughts,
        total_tokens=total_all,
        total_cost_usd=cost,
        turn_count=turn,
        finished_via_tool=tools._finished,
        finish_reason=tools._finish_reason,
        final_text=final_text[:2000],
        error=error,
        function_call_count=function_call_count,
        per_turn_usage=per_turn_usage,
    )


def probe(model: str = "gemini-2.5-flash") -> RunnerResult:
    """Cheap one-shot probe — confirms API key + model are reachable.

    Sends a no-tool prompt; expects a short text reply. Returns the same
    RunnerResult shape as run_gemini for symmetric reporting.
    """
    t0 = time.monotonic()
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        return RunnerResult(
            success=False,
            duration_seconds=0.0,
            total_input_tokens=0,
            total_output_tokens=0,
            total_thoughts_tokens=0,
            total_tokens=0,
            total_cost_usd=0.0,
            turn_count=0,
            finished_via_tool=False,
            finish_reason=None,
            final_text="",
            error="GEMINI_API_KEY not set",
        )

    client = genai.Client(api_key=key)
    try:
        response = client.models.generate_content(
            model=model,
            contents="Reply with the single word OK.",
        )
    except Exception as e:  # noqa: BLE001
        return RunnerResult(
            success=False,
            duration_seconds=time.monotonic() - t0,
            total_input_tokens=0,
            total_output_tokens=0,
            total_thoughts_tokens=0,
            total_tokens=0,
            total_cost_usd=0.0,
            turn_count=0,
            finished_via_tool=False,
            finish_reason=None,
            final_text="",
            error=f"{type(e).__name__}: {e}",
        )

    usage = response.usage_metadata
    in_tok = usage.prompt_token_count or 0 if usage else 0
    out_tok = usage.candidates_token_count or 0 if usage else 0
    thoughts_tok = getattr(usage, "thoughts_token_count", None) or 0 if usage else 0
    return RunnerResult(
        success=True,
        duration_seconds=time.monotonic() - t0,
        total_input_tokens=in_tok,
        total_output_tokens=out_tok + thoughts_tok,
        total_thoughts_tokens=thoughts_tok,
        total_tokens=in_tok + out_tok + thoughts_tok,
        total_cost_usd=_estimate_cost_usd(model, in_tok, out_tok + thoughts_tok),
        turn_count=1,
        finished_via_tool=False,
        finish_reason=None,
        final_text=(response.text or "").strip(),
        error=None,
    )
