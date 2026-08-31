"""Shared predicate parser/evaluator for the workbench filter grammar.

One grammar, three consumers: the table API (`s=` query params), the CSV
export CLI (`--filter`), and — mirrored in TypeScript — the frontend
(`frontend/src/filters/predicate.ts`). The two evaluators share golden test
vectors; keep them in lockstep.

Wire form:  "column:op:value[,value...]"   e.g.  outcome:in:fail,error
                                                 total_cost_usd:gte:0.1
                                                 route.edge:eq:a.py>b.py

Semantics: a filter list is a conjunction (AND). `in` provides OR within a
column. Values are untyped strings coerced at evaluation time against a
column-kind registry (analysis.tables.COLUMN_KINDS). `contains` folds ASCII
letters only; non-ASCII code points remain exact so Python and JavaScript have
the same deterministic behavior without locale-dependent Unicode case rules.

Run-scoped pseudo-columns (valid only when computing a run set):

  route.target      contains|eq   run touched a target containing/equal X
  route.event_type  eq|in         run has >= 1 step of these types
  route.edge        eq            run traversed transition "source>target"
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from itertools import pairwise
from math import isfinite

from runograph_backend.analysis import route_graph as rg_mod
from runograph_backend.analysis import tables as tables_mod
from runograph_backend.storage.schemas import CanonicalEvent, is_public_id

# op set per column kind
KIND_OPS: dict[str, frozenset[str]] = {
    "number": frozenset({"gt", "gte", "lt", "lte", "between", "eq", "absgte"}),
    "enum": frozenset({"eq", "in"}),
    "string": frozenset({"eq", "in", "contains"}),
    "boolean": frozenset({"eq"}),
}

ALL_OPS = frozenset().union(*KIND_OPS.values())

# ops that take exactly one value / exactly two values (others: >= 1)
_SINGLE_VALUE_OPS = frozenset({"gt", "gte", "lt", "lte", "eq", "absgte", "contains"})
_TWO_VALUE_OPS = frozenset({"between"})

ROUTE_PSEUDO_OPS: dict[str, frozenset[str]] = {
    "route.target": frozenset({"contains", "eq"}),
    "route.event_type": frozenset({"eq", "in"}),
    "route.edge": frozenset({"eq"}),
}

EDGE_SEPARATOR = ">"
_DECIMAL_NUMBER_RE = re.compile(
    r"^[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?)|(?:\.[0-9]+))(?:[eE][+-]?[0-9]+)?$"
)
_ASCII_CASE_TRANSLATION = str.maketrans(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"
)


def _ascii_fold(value: str) -> str:
    """Fold ASCII letters only, identically to the TypeScript evaluator."""
    return value.translate(_ASCII_CASE_TRANSLATION)


@dataclass(frozen=True)
class Predicate:
    column: str
    op: str
    values: tuple[str, ...]


def parse_filter(raw: str) -> Predicate:
    """Parse one "column:op:values" string. Raises ValueError on bad grammar."""
    parts = raw.split(":", 2)
    if len(parts) != 3:
        raise ValueError(f"filter {raw!r}: expected column:op:value")
    column, op, value_part = parts
    if not column:
        raise ValueError(f"filter {raw!r}: empty column")
    if op not in ALL_OPS:
        raise ValueError(f"filter {raw!r}: unknown op {op!r}")
    if value_part == "":
        raise ValueError(f"filter {raw!r}: empty value")
    values = tuple(value_part.split(","))
    if any(v == "" for v in values):
        raise ValueError(f"filter {raw!r}: empty value in list")
    if op in _SINGLE_VALUE_OPS and len(values) != 1:
        raise ValueError(f"filter {raw!r}: op {op!r} takes exactly one value")
    if op in _TWO_VALUE_OPS and len(values) != 2:
        raise ValueError(f"filter {raw!r}: op {op!r} takes exactly two values")
    return Predicate(column=column, op=op, values=values)


def parse_filters(raw: list[str]) -> list[Predicate]:
    return [parse_filter(r) for r in raw]


def parse_run_whitelist(raw: str | None) -> set[str] | None:
    """Parse the runs= csv whitelist. None means "no whitelist"."""
    if raw is None:
        return None
    parts = raw.split(",")
    if not parts or any(not part for part in parts):
        raise ValueError("runs=: no run ids")
    ids = set(parts)
    invalid = sorted(run_id for run_id in ids if not is_public_id(run_id))
    if invalid:
        raise ValueError(
            "runs=: invalid run id; expected 1-128 ASCII letters, digits, '.', "
            "'_' or '-' with an alphanumeric first character"
        )
    return ids


def validate_predicates(preds: list[Predicate], kinds: dict[str, str]) -> None:
    """Check columns exist, ops fit the column kind, values coerce.

    `kinds` maps column -> kind for plain columns; route.* pseudo-columns are
    validated against ROUTE_PSEUDO_OPS. Raises ValueError.
    """
    for p in preds:
        if p.column in ROUTE_PSEUDO_OPS:
            if p.op not in ROUTE_PSEUDO_OPS[p.column]:
                raise ValueError(f"filter column {p.column!r}: op {p.op!r} not allowed")
            if p.column == "route.edge":
                parts = p.values[0].split(EDGE_SEPARATOR)
                if len(parts) != 2 or not all(parts):
                    raise ValueError(
                        "filter column 'route.edge': expected source>target"
                    )
            continue
        kind = kinds.get(p.column)
        if kind is None:
            raise ValueError(f"filter column {p.column!r}: unknown column")
        if p.op not in KIND_OPS[kind]:
            raise ValueError(
                f"filter column {p.column!r} ({kind}): op {p.op!r} not allowed"
            )
        if kind == "number":
            for v in p.values:
                if _DECIMAL_NUMBER_RE.fullmatch(v) is None:
                    raise ValueError(
                        f"filter column {p.column!r}: non-numeric value {v!r}"
                    )
                try:
                    parsed = float(v)
                except ValueError:
                    raise ValueError(
                        f"filter column {p.column!r}: non-numeric value {v!r}"
                    ) from None
                if not isfinite(parsed):
                    raise ValueError(
                        f"filter column {p.column!r}: non-finite value {v!r}"
                    )
        elif kind == "boolean":
            for v in p.values:
                if _ascii_fold(v) not in ("true", "false", "1", "0"):
                    raise ValueError(
                        f"filter column {p.column!r}: non-boolean value {v!r}"
                    )


def _matches_one(row_value: object, p: Predicate, kind: str) -> bool:
    if kind == "number":
        if row_value is None:
            return False
        v = float(row_value)
        nums = [float(x) for x in p.values]
        if p.op == "gt":
            return v > nums[0]
        if p.op == "gte":
            return v >= nums[0]
        if p.op == "lt":
            return v < nums[0]
        if p.op == "lte":
            return v <= nums[0]
        if p.op == "between":
            lo, hi = sorted(nums)
            return lo <= v <= hi
        if p.op == "eq":
            return v == nums[0]
        if p.op == "absgte":
            return abs(v) >= nums[0]
        return False
    if kind == "boolean":
        want = _ascii_fold(p.values[0]) in ("true", "1")
        return bool(row_value) == want
    # enum / string
    sval = str(row_value)
    if p.op == "eq":
        return sval == p.values[0]
    if p.op == "in":
        return sval in p.values
    if p.op == "contains":
        return _ascii_fold(p.values[0]) in _ascii_fold(sval)
    return False


def row_matches(row: dict, preds: list[Predicate], kinds: dict[str, str]) -> bool:
    """AND-evaluate plain-column predicates against one builder row dict."""
    return all(_matches_one(row.get(p.column), p, kinds[p.column]) for p in preds)


def _route_matches(events: list[CanonicalEvent], p: Predicate) -> bool:
    route = rg_mod.events_to_route(events)
    if p.column == "route.target":
        if p.op == "eq":
            return any((e.target or "") == p.values[0] for e in route)
        needle = _ascii_fold(p.values[0])
        return any(needle in _ascii_fold(e.target or "") for e in route)
    if p.column == "route.event_type":
        wanted = set(p.values)
        return any(e.type in wanted for e in route)
    # route.edge
    src, _, dst = p.values[0].partition(EDGE_SEPARATOR)
    seq = [e.target for e in route if e.target]
    return any(a == src and b == dst for a, b in pairwise(seq))


def scoped_run_ids(
    data: tables_mod.ExperimentData,
    run_rows: list[dict],
    preds: list[Predicate],
    whitelist: set[str] | None,
) -> set[str]:
    """Resolve a run scope: plain predicates against run rows, route.*
    predicates against events, whitelist intersected last."""
    ids = {row["run_id"] for row in run_rows}
    plain = [p for p in preds if p.column not in ROUTE_PSEUDO_OPS]
    route_preds = [p for p in preds if p.column in ROUTE_PSEUDO_OPS]
    if plain:
        kinds = tables_mod.COLUMN_KINDS["runs"]
        ids &= {r["run_id"] for r in run_rows if row_matches(r, plain, kinds)}
    for p in route_preds:
        ids = {rid for rid in ids if _route_matches(data.events_by_run.get(rid, []), p)}
    if whitelist is not None:
        ids &= whitelist
    return ids


def narrow(data: tables_mod.ExperimentData, ids: set[str]) -> tables_mod.ExperimentData:
    """ExperimentData restricted to a run-id subset."""
    return tables_mod.ExperimentData(
        experiment_id=data.experiment_id,
        runs=[r for r in data.runs if r.id in ids],
        events_by_run={rid: ev for rid, ev in data.events_by_run.items() if rid in ids},
    )
