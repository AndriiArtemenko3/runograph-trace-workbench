"""Cluster N agent routes into K path families via sequence distance.

Each run becomes an ordered sequence of file/action targets. We compute
pairwise Levenshtein distance between sequences, then hierarchical
clustering with auto-cut at k in [3, 5] (configurable). The cluster
representative is the medoid: the run whose mean distance to other
cluster members is minimised.

Heavy deps (`scipy`, `Levenshtein`) are lazy-imported inside the
top-level entry point so the module is safe to import in environments
without them (e.g. tests / lint).
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


def _encode_routes_for_levenshtein(
    routes: dict[str, list[str]],
) -> tuple[dict[str, str], dict[str, str]]:
    """Map each unique target to a single Unicode char.

    Levenshtein.distance operates on strings, so we collapse each route
    `[target, target, ...]` into a string of one char per step. Returns
    (encoded_routes, vocab) where encoded_routes[run_id] is the encoded
    string and vocab maps target -> single char (debug-only).
    """
    vocab: dict[str, str] = {}
    counter = 0
    for seq in routes.values():
        for target in seq:
            if target not in vocab:
                # Skip ASCII control range so encoded strings stay printable.
                vocab[target] = chr(0x4E00 + counter)
                counter += 1

    encoded = {rid: "".join(vocab[t] for t in seq) for rid, seq in routes.items()}
    return encoded, vocab


def cluster_routes(
    routes: dict[str, list[str]],
    k_range: tuple[int, int] = (3, 5),
    method: str = "average",
) -> ClusterResult:
    """Cluster the input routes into k ∈ [k_min, k_max] groups.

    `routes`: {run_id: [target, target, ...]} — sorted by ts upstream.
    Returns a `ClusterResult` with per-run cluster ids + representative
    run ids per cluster.

    Auto-cut strategy for k: try every k in `k_range`, pick the one with
    the highest mean silhouette score across runs. Falls back to the
    midpoint of `k_range` if every k yields a single-cluster result
    (degenerate).
    """
    if not routes:
        return ClusterResult(assignments=[], centroids_by_cluster={}, k=0)

    # Edge case: fewer routes than the smallest requested k — return a single cluster
    if len(routes) < k_range[0]:
        run_ids = list(routes.keys())
        return ClusterResult(
            assignments=[
                ClusterAssignment(run_id=rid, cluster_id=1, distance_to_centroid=0.0)
                for rid in run_ids
            ],
            centroids_by_cluster={1: run_ids[0]},
            k=1,
        )

    # Lazy imports — scipy + Levenshtein only loaded when clustering runs
    import numpy as np
    from Levenshtein import distance as lev
    from scipy.cluster.hierarchy import fcluster, linkage
    from scipy.spatial.distance import squareform

    encoded, _vocab = _encode_routes_for_levenshtein(routes)
    run_ids = list(encoded.keys())
    n = len(run_ids)

    # Pairwise distance matrix (N x N, symmetric, zero diagonal)
    matrix = np.zeros((n, n), dtype=float)
    for i in range(n):
        for j in range(i + 1, n):
            d = float(lev(encoded[run_ids[i]], encoded[run_ids[j]]))
            matrix[i, j] = d
            matrix[j, i] = d

    # Hierarchical linkage on the condensed distance vector
    condensed = squareform(matrix, checks=False)
    z = linkage(condensed, method=method)

    # Try each k in the requested range, pick the one with the best silhouette.
    # Silhouette: mean over runs of (b - a) / max(a, b)
    #   a = mean intra-cluster distance for the run
    #   b = mean nearest-cluster distance for the run
    best_k = k_range[0]
    best_score = -2.0
    best_labels: list[int] | None = None

    for k in range(k_range[0], k_range[1] + 1):
        if k > n:
            continue
        labels = fcluster(z, t=k, criterion="maxclust").tolist()
        unique = set(labels)
        if len(unique) < 2:
            continue
        score = _silhouette(matrix, labels)
        if score > best_score:
            best_score = score
            best_k = k
            best_labels = labels

    if best_labels is None:
        # Fallback: midpoint of range, accept whatever fcluster yields
        best_k = (k_range[0] + k_range[1]) // 2
        best_labels = fcluster(z, t=best_k, criterion="maxclust").tolist()

    # Compute centroid (medoid) per cluster + each run's distance to it
    by_cluster: dict[int, list[int]] = {}
    for idx, lab in enumerate(best_labels):
        by_cluster.setdefault(lab, []).append(idx)

    centroids: dict[int, str] = {}
    assignments: list[ClusterAssignment] = []
    for cluster_id, indices in by_cluster.items():
        # medoid index = argmin of mean distance to others in the cluster
        best_idx = indices[0]
        best_mean = float("inf")
        for i in indices:
            mean_d = float(matrix[i, indices].sum() / max(len(indices) - 1, 1))
            if mean_d < best_mean:
                best_mean = mean_d
                best_idx = i
        centroids[cluster_id] = run_ids[best_idx]
        for i in indices:
            assignments.append(
                ClusterAssignment(
                    run_id=run_ids[i],
                    cluster_id=int(cluster_id),
                    distance_to_centroid=float(matrix[i, best_idx]),
                )
            )

    return ClusterResult(assignments=assignments, centroids_by_cluster=centroids, k=best_k)


def _silhouette(matrix, labels: list[int]) -> float:
    """Mean silhouette coefficient over all runs.

    Vectorised against the precomputed distance matrix to avoid recomputing
    Levenshtein. Returns 0.0 for the degenerate single-cluster case.
    """
    import numpy as np

    n = len(labels)
    arr = np.asarray(labels)
    if len(set(labels)) < 2:
        return 0.0

    scores = np.zeros(n)
    for i in range(n):
        own = arr == arr[i]
        own[i] = False  # exclude self
        if not own.any():
            scores[i] = 0.0
            continue
        a = float(matrix[i, own].mean())
        b_candidates = []
        for c in set(labels):
            if c == arr[i]:
                continue
            mask = arr == c
            if mask.any():
                b_candidates.append(float(matrix[i, mask].mean()))
        if not b_candidates:
            scores[i] = 0.0
            continue
        b = min(b_candidates)
        denom = max(a, b)
        scores[i] = (b - a) / denom if denom > 0 else 0.0
    return float(scores.mean())
