# Publication checklist

This checklist separates locally verifiable repository quality from actions
that require the repository owner, GitHub UI access, or legal judgment. Do not
change visibility until every blocking item is resolved.

## Default-branch engineering gates

- [x] Review the complete branch diff; confirm it contains only intentional
  offline-workbench changes and no generated SQLite files, exports,
  `node_modules`, `.venv`, caches, or captured corpora.
- [x] From a clean Python 3.12 environment, run
  `uv sync --python 3.12.13 --extra dev --frozen`, then `uv lock --check
  --offline`, Ruff, and pytest (CI pins uv 0.11.31).
- [x] Run the frozen pnpm install, frontend tests, typecheck, and production
  build with Node 24.20.0 and pnpm 11.25.0.
- [x] Seed `demo-offline`, launch both services on loopback, and visually check
  loading, empty, error, and populated states.
- [x] Confirm the public tree contains no runnable model-agent harness, model
  API dependency, generated-shell path, heuristic grader, or price table.
- [x] Confirm the outcome-invariance clustering regression is present and
  green.
- [x] Confirm mixed-offset/DST chronology, route-ID collision, cluster
  permutation, concurrent initialization, atomic reseed, fail-closed URL, hash
  history, and POSIX permission regressions are present and green.

## Privacy, credentials, and history

Pre-publication audit baseline on 2026-08-31: Gitleaks 8.30.1 scanned the
candidate directory and the complete 40-commit `main` history. The candidate
tree was clean. The `main` scan was clean with one narrow, documented
fingerprint ignore for a reviewed historical static schema descriptor that is
not a credential. Separately audited legacy refs were preserved in a verified
private archive before cleanup; no live credential was identified. Re-run the
scan after remote-ref cleanup so the exact public ref set exits clean. Reachable
default-branch history contains retired local-path references even though the
current tree is clean.

- [ ] Scan every reachable public ref with the maintained scanner immediately
  before visibility, for example: `gitleaks git --redact --no-banner .`. Review findings without
  copying credential values into issues or logs; rotate any real credential
  before publication.
- [ ] Refresh and enumerate every advertised remote ref immediately before the
  decision: `git ls-remote origin`. Do not rely on heads-only output because
  tags can keep older snapshots prominently reachable.
- [x] Audit every advertised branch, not only `main`, and preserve excluded
  refs in a verified private archive.
- [ ] Remove advertised refs excluded from the intended public set because
  they contain internal workflow material or a different product identity.
  Branch deletion or history rewriting is a separate owner-authorized
  operation.
- [x] Search all reachable commits for private paths, personal data, generated
  corpora/databases, proprietary third-party material, and stale credentials.
- [ ] Verify that synthetic fixtures are clearly synthetic and contain no
  copied customer or production data.

## Legal and owner decisions

- [ ] The owner confirms that publishing source under the current proprietary
  license is intentional. Obtain legal review if needed. Do not describe the
  repository as open source.
- [ ] Confirm that publishing the personal name and licensing-contact email
  already present in `LICENSE` and package metadata is intentional.
- [ ] Verify ownership and redistribution rights for every asset and
  dependency notice. The `LICENSE` file is unchanged and controls use.
- [x] Preserve any separately licensed historical CLI snapshot in the private
  archive before deleting its public branch; keep the historical-license note
  accurate after cleanup.
- [ ] Choose visibility explicitly in GitHub after all other gates pass. Do not
  infer publication authority from code-readiness work.

## Recommended GitHub metadata

Suggested description:

> Offline workbench for ingesting and exploring AI-agent execution traces with behavior-only clustering and externally supplied outcomes.

Suggested topics:

`ai-agents`, `observability`, `trace-analysis`, `offline-first`, `data-visualization`,
`fastapi`, `react`, `sqlite`, `python`, `typescript`

- [ ] Set the description and topics in GitHub only after owner approval.
- [ ] Leave the homepage blank until there is an owner-approved public landing
  page or hosted demo; do not imply that the local-only app is a public SaaS.
- [ ] Upload an owner-approved social preview derived from the synthetic demo.
  Check at small-card size and confirm that no local path, username, customer
  identifier, or real trace content is visible.
- [x] Capture the current stable Workbench from a freshly seeded
  `demo-offline` database, then inspect the image for paths, usernames,
  identifiers, metadata, and readable contrast before adding it to the README.

## GitHub and release controls

- [ ] Require the actual green CI checks on the default branch. Do not mark
  mypy required: strict mypy is not currently a repository gate.
- [ ] Review security/contact settings, issue availability, and whether
  contributions are accepted for this proprietary repository.
- [ ] Verify the default branch, repository name, and product identity across
  branch content before changing visibility.
- [ ] After publication, inspect the public repository as a signed-out user and
  verify README rendering, license visibility, branch exposure, social preview,
  and absence of unintended artifacts.
- [ ] Inspect Actions history as well as Git refs; workflow-run pages can retain
  references to commits from branches that were later deleted.
- [ ] Treat any release, deployment, tag, branch cleanup, or history rewrite as
  a separate reviewed action.
