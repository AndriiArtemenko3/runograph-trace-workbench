"""Feature-vector k-means clustering for agent runs.

Each run is reduced to a small numeric feature vector capturing:

  * structural shape: event_count, unique_target_count, error_count
  * composition: ratio of file_read / file_edit / tool_call events
  * outcome: pass and error as separate one-hot signals
  * magnitude: log1p(tokens) and log1p(cents)

These ten features are z-normalised across the dataset, then k-means runs
across `k_range` (default 2..12). The best `k` is picked by silhouette
on the Euclidean distance matrix. Clusters are re-labelled so cluster_id
ascends with descending size (cluster 1 is largest).

This replaces a previous symbol-equality Levenshtein approach that
overlumped 42 of 50 runs into one cluster on the runograph-50 dataset:
shape signatures `T` (1-event fail), `REF` (canonical 3-event fix), and
`RTRRREEF` (8-event explore-then-fix) all collided at distance ≤ 5 on
short Unicode-encoded strings, regardless of how different the actual
runs were in cost, outcome, or exploration depth.

Heavy deps (`scipy`, `numpy`) are lazy-imported inside the entry point
so the module is safe to import in environments without them.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ClusterAssignment:
    run_id: str
    cluster_id: int
    distance_to_centroid: float


@dataclass
class ClusterResult:
    assignments: list[ClusterAssignment]
    centroids_by_cluster: dict[int, str]  # cluster_id -> representative run_id
    k: int


@dataclass
class RunFeatures:
    """Raw inputs from one run. The caller pre-builds this from events +
    the Run row in SQLite; cluster_routes derives the feature vector."""

    event_types: list[str]          # ordered sequence of CanonicalEvent.type
    unique_target_count: int
    outcome: str                    # "pass" / "fail" / "error" / "running"
    total_tokens: int
    total_cost_usd: float


FEATURE_NAMES = (
    "event_count",
    "unique_target_count",
    "error_count",
    "ratio_reads",
    "ratio_edits",
    "ratio_tool_calls",
    "outcome_pass",
    "outcome_error",
    "log_tokens",
    "log_cost_cents",
)


def _build_feature_matrix(
    features_by_run: dict[str, RunFeatures],
):
    """Compute the (N, F) z-normalised feature matrix.

    Returns (normalized_matrix, run_ids). Empty std columns are guarded
    so constant features don't divide by zero.
    """
    import numpy as np

    run_ids = list(features_by_run.keys())
    rows = []
    for rid in run_ids:
        f = features_by_run[rid]
        n = max(1, len(f.event_types))
        read_count = sum(1 for t in f.event_types if t == "file_read")
        edit_count = sum(1 for t in f.event_types if t == "file_edit")
        tool_count = sum(1 for t in f.event_types if t in ("tool_call", "test_run"))
        error_count = sum(1 for t in f.event_types if t == "error")
        rows.append(
            [
                len(f.event_types),                                  # event_count
                f.unique_target_count,                                # unique_target_count
                error_count,                                          # error_count
                read_count / n,                                       # ratio_reads
                edit_count / n,                                       # ratio_edits
                tool_count / n,                                       # ratio_tool_calls
                1.0 if f.outcome == "pass" else 0.0,                  # outcome_pass
                1.0 if f.outcome == "error" else 0.0,                 # outcome_error
                float(np.log1p(max(0, f.total_tokens))),              # log_tokens
                float(np.log1p(max(0.0, f.total_cost_usd * 100.0))),  # log_cost_cents
            ]
        )

    matrix = np.asarray(rows, dtype=float)
    mean = matrix.mean(axis=0)
    std = matrix.std(axis=0)
    std[std == 0] = 1.0
    return (matrix - mean) / std, run_ids


def _silhouette(dist_matrix, labels: list[int]) -> float:
    """Mean silhouette coefficient against a precomputed pairwise distance
    matrix. Returns 0.0 for the degenerate single-cluster case."""
    import numpy as np

    n = len(labels)
    arr = np.asarray(labels)
    if len(set(labels)) < 2:
        return 0.0

    scores = np.zeros(n)
    cluster_ids = set(labels)
    for i in range(n):
        own_mask = arr == arr[i]
        own_mask[i] = False
        if not own_mask.any():
            scores[i] = 0.0
            continue
        a = float(dist_matrix[i, own_mask].mean())
        b_candidates: list[float] = []
        for c in cluster_ids:
            if c == arr[i]:
                continue
            mask = arr == c
            if mask.any():
                b_candidates.append(float(dist_matrix[i, mask].mean()))
        if not b_candidates:
            scores[i] = 0.0
            continue
        b = min(b_candidates)
        denom = max(a, b)
        scores[i] = (b - a) / denom if denom > 0 else 0.0
    return float(scores.mean())


def cluster_routes(
    features_by_run: dict[str, RunFeatures],
    k_range: tuple[int, int] = (2, 12),
    *,
    min_cluster_size: int = 2,
    max_largest_fraction: float = 0.7,
    seed: int = 42,
) -> ClusterResult:
    """K-means cluster runs by their feature vectors.

    `k_range` is swept; each candidate k is scored by `silhouette ×
    sqrt(1 - largest_cluster_fraction)` — the balance penalty rejects
    degenerate "everything in one cluster" outcomes that pure silhouette
    rewards (a single big cluster + 1-2 outliers can score 0.7 silhouette
    despite hiding all interesting structure). The k with the highest
    balanced score wins; ties broken by higher k (more granularity).

    Hard filters per candidate k:
      * every cluster must hold at least `min_cluster_size` runs
      * the largest cluster must not exceed `max_largest_fraction` of N
        (catches the [45, 2] degeneracy that silhouette alone would pick)

    Cluster ids are re-labelled descending by size: cluster 1 = largest.
    """
    if not features_by_run:
        return ClusterResult(assignments=[], centroids_by_cluster={}, k=0)

    if len(features_by_run) < k_range[0]:
        run_ids = list(features_by_run.keys())
        return ClusterResult(
            assignments=[
                ClusterAssignment(run_id=rid, cluster_id=1, distance_to_centroid=0.0)
                for rid in run_ids
            ],
            centroids_by_cluster={1: run_ids[0]},
            k=1,
        )

    import numpy as np
    from scipy.cluster.vq import kmeans2

    matrix, run_ids = _build_feature_matrix(features_by_run)
    n = len(run_ids)

    # Pairwise Euclidean distances for silhouette scoring
    diff = matrix[:, np.newaxis, :] - matrix[np.newaxis, :, :]
    dist_matrix = np.sqrt((diff ** 2).sum(axis=2))

    best_k = k_range[0]
    best_balanced_score = -2.0
    best_labels = None

    rng = np.random.default_rng(seed)

    for k in range(k_range[0], min(k_range[1], n) + 1):
        # kmeans2 with kmeans++ init; rerun a few seeds and keep the run with
        # the lowest inertia (cushion against poor centroid init on small N).
        best_local_labels = None
        best_local_inertia = float("inf")
        for trial in range(8):
            trial_seed = int(rng.integers(0, 1 << 31))
            try:
                _centroids, labels = kmeans2(
                    matrix,
                    k,
                    minit="++",
                    seed=trial_seed,
                    iter=100,
                    missing="warn",
                )
            except Exception:
                continue
            uniq = set(labels.tolist())
            if len(uniq) < k or len(uniq) < 2:
                continue
            sizes = [int((labels == c).sum()) for c in uniq]
            if min(sizes) < min_cluster_size:
                continue
            largest_fraction = max(sizes) / n
            if largest_fraction > max_largest_fraction:
                continue
            inertia = 0.0
            for c in uniq:
                members = matrix[labels == c]
                centroid = members.mean(axis=0)
                inertia += float(((members - centroid) ** 2).sum())
            if inertia < best_local_inertia:
                best_local_inertia = inertia
                best_local_labels = labels

        if best_local_labels is None:
            continue
        labels_list = best_local_labels.tolist()
        sil = _silhouette(dist_matrix, labels_list)
        sizes = [labels_list.count(c) for c in set(labels_list)]
        largest_fraction = max(sizes) / n
        # Balance penalty: silhouette × sqrt(1 - largest_fraction). The
        # square root softens the penalty so a slightly-imbalanced k=5 can
        # beat a perfectly-balanced k=2.
        balanced_score = sil * np.sqrt(max(0.0, 1.0 - largest_fraction))
        if balanced_score > best_balanced_score:
            best_balanced_score = balanced_score
            best_k = k
            best_labels = best_local_labels

    if best_labels is None:
        # Fallback: smallest k that worked at all
        fallback_seed = int(rng.integers(0, 1 << 31))
        _centroids, best_labels = kmeans2(
            matrix, k_range[0], minit="++", seed=fallback_seed, iter=100
        )
        best_k = k_range[0]

    labels_list = best_labels.tolist()
    by_cluster: dict[int, list[int]] = {}
    for idx, lab in enumerate(labels_list):
        by_cluster.setdefault(int(lab), []).append(idx)

    # Re-label clusters so id 1 is the largest, id 2 is next, etc.
    sorted_old_ids = sorted(by_cluster.keys(), key=lambda c: -len(by_cluster[c]))
    relabel = {old: new for new, old in enumerate(sorted_old_ids, start=1)}

    centroids_by_cluster: dict[int, str] = {}
    assignments: list[ClusterAssignment] = []
    for old_cid, indices in by_cluster.items():
        new_cid = relabel[old_cid]
        members = matrix[indices]
        centroid_vec = members.mean(axis=0)
        # Medoid: member closest to the centroid in normalised space
        dists = np.linalg.norm(members - centroid_vec, axis=1)
        medoid_local = int(np.argmin(dists))
        medoid_global = indices[medoid_local]
        centroids_by_cluster[new_cid] = run_ids[medoid_global]
        for local_i, global_i in enumerate(indices):
            assignments.append(
                ClusterAssignment(
                    run_id=run_ids[global_i],
                    cluster_id=new_cid,
                    distance_to_centroid=float(dists[local_i]),
                )
            )

    return ClusterResult(
        assignments=assignments,
        centroids_by_cluster=centroids_by_cluster,
        k=best_k,
    )
