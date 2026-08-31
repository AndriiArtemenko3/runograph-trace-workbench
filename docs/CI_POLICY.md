# CI reproducibility policy

CI fixes the runner image (`ubuntu-24.04`) and executable toolchain versions:
uv 0.11.31, CPython 3.12.13, Node.js 24.20.0, and pnpm 11.25.0. Both dependency
installs use checked-in lockfiles in frozen mode; the backend also verifies the
uv lock without network resolution.

GitHub Actions use maintained major tags for `actions/checkout` and
`pnpm/setup`. `astral-sh/setup-uv` uses its immutable `v10.0.1` release tag,
because that project no longer publishes moving major tags. This is a
deliberate maintenance/security trade-off: repository permissions are
read-only and Dependabot proposes monthly action updates for review. A future
owner may adopt immutable action SHAs together with an automated digest
updater; until then, do not describe action execution as bit-for-bit
reproducible.

Changes to any pinned executable or action major must arrive in a reviewed
change that reruns the frozen installs, backend checks, frontend tests,
typecheck, and production build.
