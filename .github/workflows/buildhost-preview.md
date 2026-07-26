Deploys a pull-request preview to a [buildhost](https://github.com/wow-look-at-my/buildhost) static-site project and posts a sticky PR comment with the preview URL. Authenticates to buildhost via GitHub OIDC (no static secret). PRs deploy to a `pr-<number>` branch; pushes deploy to `branch/<ref-name>`.

The caller must declare the permissions the reusable workflow needs (a reusable workflow cannot escalate beyond its caller):

```yml
name: PR preview
on:
  push:
    branches: [master]
  pull_request:
    types: [opened, reopened, synchronize]

permissions:
  contents: read
  actions: read         # only needed when using artifact-name
  pull-requests: write  # sticky comment
  id-token: write       # OIDC to buildhost

jobs:
  preview:
    uses: wow-look-at-my/actions/.github/workflows/buildhost-preview.yml@master
    with:
      source-dir: ./site   # directory to deploy (defaults to ".")
    secrets: inherit
```

To deploy a previously-uploaded run artifact instead of checking out `source-dir`, pass `artifact-name` (mutually exclusive with `source-dir`):

```yml
jobs:
  preview:
    uses: wow-look-at-my/actions/.github/workflows/buildhost-preview.yml@master
    with:
      artifact-name: build
    secrets: inherit
```

Notes:

- `project` defaults to the repository name. buildhost derives the project as the **lowercase** repo name and rejects a mismatch, so pin `project:` explicitly if your repo name is not already lowercase.
- `public: true` serves the preview without buildhost auth even when the source repo/project is private (opt-in; default `false` keeps a private repo's preview gated).
- Fork PRs are skipped (they receive no OIDC token and cannot authenticate to buildhost).
- The GitHub Pages flavour lives in [PazerOP/pr-preview-action](https://github.com/PazerOP/pr-preview-action) (reusable workflow `.github/workflows/preview.yml@master`). GitHub Pages is no longer available for wow-look-at-my org repos (shut off org-wide 2026-07-20), so this workflow is the path for org repos.
