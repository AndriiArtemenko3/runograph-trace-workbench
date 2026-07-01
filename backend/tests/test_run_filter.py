"""Predicate grammar + evaluator tests.

GOLDEN_PARSE / GOLDEN_REJECT / MATCH_TABLE are the shared vectors — the
frontend twin (frontend/src/filters/predicate.test.ts) must assert the
same cases. Change them in lockstep.
"""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

import pytest

from runograph_backend.analysis import run_filter, tables
from runograph_backend.storage.schemas import CanonicalEvent, EventCost

# ----- shared golden vectors -----

GOLDEN_PARSE = [
    ("outcome:in:fail,error", "outcome", "in", ("fail", "error")),
    ("total_cost_usd:gte:0.1", "total_cost_usd", "gte", ("0.1",)),
    ("cost_usd_z:absgte:2", "cost_usd_z", "absgte", ("2",)),
    ("target:contains:reporters", "target", "contains", ("reporters",)),
    ("total_tokens:between:1000,2000", "total_tokens", "between", ("1000", "2000")),
    ("is_representative:eq:true", "is_representative", "eq", ("true",)),
    ("route.edge:eq:a.py>b.py", "route.edge", "eq", ("a.py>b.py",)),
]

GOLDEN_REJECT = [
    "outcome",                       # no op/value
    "outcome:in",                    # no value
    "outcome:zz:x",                  # unknown op
    "total_tokens:between:1",        # between needs 2 values
    "total_cost_usd:gte:0.1,0.2",    # gte takes one value
    ":eq:1",                         # empty column
    "outcome:in:fail,",              # empty value in list
]

# (row-field overrides, predicate string, expected match)
MATCH_TABLE = [
    ({}, "outcome:eq:pass", True),
    ({}, "outcome:in:fail,error", False),
    ({}, "total_cost_usd:gte:0.1", True),
    ({}, "total_cost_usd:lt:0.1", False),
    ({}, "total_tokens:between:10000,12000", True),
    ({}, "run_id:contains:SAMPLE", True),          # contains is case-insensitive
    ({}, "run_id:eq:SAMPLE-RUN-0001", False),      # eq is exact
    ({}, "cluster_id:eq:1", True),
    ({}, "cluster_id:in:2,3", False),
    ({}, "is_representative:eq:true", True),
    ({}, "is_representative:eq:false", False),
    ({"cost_usd_z": -2.5}, "cost_usd_z:absgte:2", True),
    ({"cost_usd_z": 1.9}, "cost_usd_z:absgte:2", False),
]

BASE_ROW = {
    "run_id": "sample-run-0001",
    "task_id": "pylint-dev__pylint-7993",
    "model": "claude-sonnet-4-6",
    "outcome": "pass",
    "total_tokens": 11842,
    "total_cost_usd": 0.12,
    "latency_s": 137.0,
    "event_count": 10,
    "tool_call_count": 3,
    "unique_targets": 5,
    "error_count": 0,
    "cluster_id": 1,
    "distance_to_centroid": 0.0,
    "is_representative": True,
    "cost_usd_z": 0.0,
    "tokens_total_z": 0.0,
    "latency_s_z": 0.0,
    "event_count_z": 0.0,
}


@pytest.mark.parametrize("raw,column,op,values", GOLDEN_PARSE)
def test_parse_golden(raw, column, op, values):
    p = run_filter.parse_filter(raw)
    assert (p.column, p.op, p.values) == (column, op, values)


@pytest.mark.parametrize("raw", GOLDEN_REJECT)
def test_parse_rejects(raw):
    with pytest.raises(ValueError):
        run_filter.parse_filter(raw)


@pytest.mark.parametrize("overrides,raw,expected", MATCH_TABLE)
def test_row_matches_truth_table(overrides, raw, expected):
    row = {**BASE_ROW, **overrides}
    preds = [run_filter.parse_filter(raw)]
    kinds = tables.COLUMN_KINDS["runs"]
    run_filter.validate_predicates(preds, kinds)
    assert run_filter.row_matches(row, preds, kinds) is expected


def test_validate_rejects_unknown_column_and_kind_mismatch():
    kinds = tables.COLUMN_KINDS["runs"]
    with pytest.raises(ValueError):
        run_filter.validate_predicates([run_filter.parse_filter("nope:eq:1")], kinds)
    with pytest.raises(ValueError):  # numeric op on enum column
        run_filter.validate_predicates([run_filter.parse_filter("outcome:gte:1")], kinds)
    with pytest.raises(ValueError):  # non-numeric value on number column
        run_filter.validate_predicates(
            [run_filter.parse_filter("total_tokens:gte:abc")], kinds
        )
    with pytest.raises(ValueError):  # bad op on route pseudo-column
        run_filter.validate_predicates(
            [run_filter.parse_filter("route.edge:contains:x")], kinds
        )


# ----- route predicates + scoping over fabricated experiment data -----


def _evt(i: int, type_: str, target: str | None) -> CanonicalEvent:
    return CanonicalEvent(
        event_id=f"e{i:03d}",
        timestamp=datetime(2026, 1, 1, 0, 0, i),
        type=type_,
        target=target,
        content_summary="",
        cost=EventCost(tokens=10, time_seconds=0.1),
        parent_event_id=None,
        task_relevance_score=None,
    )


def _fake_data() -> tables.ExperimentData:
    events_by_run = {
        "r-a": [_evt(1, "file_read", "a.py"), _evt(2, "file_edit", "b.py")],
        "r-b": [_evt(1, "file_read", "a.py"), _evt(2, "error", "c.py")],
        "r-c": [],
    }
    runs = [
        SimpleNamespace(id=rid, outcome="pass") for rid in events_by_run
    ]
    return tables.ExperimentData(
        experiment_id="fake", runs=runs, events_by_run=events_by_run
    )


def _run_rows(data: tables.ExperimentData) -> list[dict]:
    return [{**BASE_ROW, "run_id": rid} for rid in data.events_by_run]


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("route.target:contains:A.PY", {"r-a", "r-b"}),
        ("route.target:eq:b.py", {"r-a"}),
        ("route.event_type:in:error", {"r-b"}),
        ("route.edge:eq:a.py>b.py", {"r-a"}),
        ("route.edge:eq:b.py>a.py", set()),
    ],
)
def test_route_predicates(raw, expected):
    data = _fake_data()
    ids = run_filter.scoped_run_ids(
        data, _run_rows(data), [run_filter.parse_filter(raw)], None
    )
    assert ids == expected


def test_whitelist_intersects_predicates():
    data = _fake_data()
    preds = [run_filter.parse_filter("route.target:contains:a.py")]
    ids = run_filter.scoped_run_ids(data, _run_rows(data), preds, {"r-b", "r-c"})
    assert ids == {"r-b"}


def test_narrow_preserves_experiment_id():
    data = _fake_data()
    narrowed = run_filter.narrow(data, {"r-a"})
    assert narrowed.experiment_id == "fake"
    assert [r.id for r in narrowed.runs] == ["r-a"]
    assert set(narrowed.events_by_run) == {"r-a"}


def test_column_kinds_match_column_constants():
    for sheet, columns in [
        ("runs", tables.RUNS_COLUMNS),
        ("steps", tables.STEPS_COLUMNS),
        ("clusters", tables.CLUSTERS_COLUMNS),
        ("edges", tables.EDGES_COLUMNS),
    ]:
        assert set(tables.COLUMN_KINDS[sheet]) == set(columns), sheet
