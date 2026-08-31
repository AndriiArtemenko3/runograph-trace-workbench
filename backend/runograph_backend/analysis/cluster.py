"""Feature-vector k-means clustering for agent runs.

Each run is reduced to a small numeric feature vector capturing:

  * structural shape: event_count, unique_target_count, error_count
  * composition: ratio of file_read / file_edit / tool_call events
  * magnitude: log1p(event tokens) and log1p(event time)

These eight behavior-only features are z-normalised across the dataset, then
k-means runs across `k_range` (default 2..12). The best `k` is picked by
silhouette on the Euclidean distance matrix. Clusters are re-labelled so
cluster_id ascends with descending size (cluster 1 is largest), with
canonical member ids breaking equal-size ties.

Terminal outcomes are deliberately absent from both `RunFeatures` and the
feature vector. Callers may attach pass/fail/error labels only after cluster
assignment, for reporting such as per-cluster pass and error rates.

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
    """Behavioral inputs from one run used to derive the feature vector.

    Terminal outcome is intentionally not accepted here: clustering must be
    invariant when a caller changes only its post-hoc outcome labels.
    """

    event_types: list[str]          # ordered sequence of CanonicalEvent.type
    unique_target_count: int
    event_tokens: int
    event_time_seconds: float


FEATURE_NAMES = (
    "event_count",
    "unique_target_count",
    "error_count",
    "ratio_reads",
    "ratio_edits",
    "ratio_tool_calls",
    "log_event_tokens",
    "log_event_time_seconds",
)


def _build_feature_matrix(
    features_by_run: dict[str, RunFeatures],
):
    """Compute the (N, F) z-normalised feature matrix.

    Returns (normalized_matrix, run_ids). Empty std columns are guarded
    so constant features don't divide by zero.
    """
    import numpy as np

    # Mapping insertion order can reflect database row order. Canonicalise
    # it before both normalisation and seeded k-means so the same experiment
    # always presents the same matrix to scipy.
    run_ids = sorted(features_by_run)
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
                float(np.log1p(max(0, f.event_tokens))),               # event token magnitude
                float(np.log1p(max(0.0, f.event_time_seconds))),       # event time magnitude
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
    cluster_ids = sorted(set(labels))
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

    `k_range` is swept; each candidate k is scored by `silhouette x
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
    Equal-size clusters are ordered by their sorted member ids, and medoid
    ties select the lexicographically-smallest run id.
    """
    if not features_by_run:
        return ClusterResult(assignments=[], centroids_by_cluster={}, k=0)

    import numpy as np
    from scipy.cluster.vq import kmeans2

    matrix, run_ids = _build_feature_matrix(features_by_run)
    n = len(run_ids)
    unique_row_count = len(np.unique(matrix, axis=0))

    # Pairwise Euclidean distances for silhouette scoring
    diff = matrix[:, np.newaxis, :] - matrix[np.newaxis, :, :]
    dist_matrix = np.sqrt((diff ** 2).sum(axis=2))

    best_k = 1
    best_balanced_score = -2.0
    best_labels = None

    rng = np.random.default_rng(seed)

    for k in range(k_range[0], min(k_range[1], n, unique_row_count) + 1):
        # kmeans2 with kmeans++ init; rerun a few seeds and keep the run with
        # the lowest inertia (cushion against poor centroid init on small N).
        best_local_labels = None
        best_local_inertia = float("inf")
        best_local_signature: tuple[tuple[str, ...], ...] | None = None
        for _trial in range(8):
            trial_seed = int(rng.integers(0, 1 << 31))
            try:
                _centroids, labels = kmeans2(
                    matrix,
                    k,
                    minit="++",
                    seed=trial_seed,
                    iter=100,
                    missing="raise",
                )
            except Exception:
                continue
            uniq = sorted(set(labels.tolist()))
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

            # Raw scipy label numbers have no meaning. Canonical member
            # groups make an equal-inertia tie independent of those labels
            # and pick deterministically when multiple partitions tie.
            signature = tuple(
                sorted(
                    tuple(
                        run_ids[index]
                        for index, label in enumerate(labels)
                        if label == c
                    )
                    for c in uniq
                )
            )
            if inertia < best_local_inertia or (
                inertia == best_local_inertia
                and (best_local_signature is None or signature < best_local_signature)
            ):
                best_local_inertia = inertia
                best_local_labels = labels
                best_local_signature = signature

        if best_local_labels is None:
            continue
        labels_list = best_local_labels.tolist()
        sil = _silhouette(dist_matrix, labels_list)
        sizes = [labels_list.count(c) for c in sorted(set(labels_list))]
        largest_fraction = max(sizes) / n
        # Balance penalty: silhouette x sqrt(1 - largest_fraction). The
        # square root softens the penalty so a slightly-imbalanced k=5 can
        # beat a perfectly-balanced k=2.
        balanced_score = sil * np.sqrt(max(0.0, 1.0 - largest_fraction))
        score_tied = bool(
            np.isclose(
                balanced_score,
                best_balanced_score,
                rtol=1e-12,
                atol=1e-12,
            )
        )
        if (balanced_score > best_balanced_score and not score_tied) or (
            score_tied and k > best_k
        ):
            best_balanced_score = balanced_score
            best_k = k
            best_labels = best_local_labels

    if best_labels is None:
        # No requested candidate satisfied the hard constraints (or every
        # behavior vector is identical). A single honest cluster is more
        # useful than forcing k-means to emit empty clusters and warnings.
        best_labels = np.zeros(n, dtype=int)

    labels_list = best_labels.tolist()
    by_cluster: dict[int, list[int]] = {}
    for idx, lab in enumerate(labels_list):
        by_cluster.setdefault(int(lab), []).append(idx)

    # Re-label clusters so id 1 is the largest, id 2 is next, etc. Raw
    # k-means label ids cannot break equal-size ties because they can be
    # permuted without changing a solution; canonical member ids can.
    sorted_old_ids = sorted(
        by_cluster,
        key=lambda c: (
            -len(by_cluster[c]),
            tuple(sorted(run_ids[index] for index in by_cluster[c])),
        ),
    )
    relabel = {old: new for new, old in enumerate(sorted_old_ids, start=1)}

    centroids_by_cluster: dict[int, str] = {}
    assignments: list[ClusterAssignment] = []
    for old_cid in sorted_old_ids:
        indices = by_cluster[old_cid]
        new_cid = relabel[old_cid]
        members = matrix[indices]
        centroid_vec = members.mean(axis=0)
        # Medoid: member closest to the centroid in normalised space. An
        # explicit run-id tie-break avoids relying on array order.
        dists = np.linalg.norm(members - centroid_vec, axis=1)
        medoid_local = min(
            range(len(indices)),
            key=lambda local_i: (
                float(dists[local_i]),
                run_ids[indices[local_i]],
            ),
        )
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
        assignments=sorted(assignments, key=lambda assignment: assignment.run_id),
        centroids_by_cluster=centroids_by_cluster,
        k=best_k,
    )
