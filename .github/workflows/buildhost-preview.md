Deploys a pull-request preview to a [buildhost](https://github.com/wow-look-at-my/buildhost) static-site project. It posts a sticky PR comment with the preview URL. It authenticates to buildhost over GitHub OIDC, with no static secret. A PR deploys to a `pr-<number>` branch. A push deploys to `branch/<ref-name>`.

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

- `project` defaults to the repository name. buildhost derives the project as the **lowercase** repo name, and it rejects a mismatch. Pin `project:` explicitly where the repo name is not already lowercase.
- `public: true` serves the preview without buildhost auth, even where the source repo or project is private. It is opt-in. The default `false` keeps the preview of a private repo gated.
- The upload is buildhost's own `buildhost-publish-site` action: a tar.gz PUT to `sites.<domain>/<project>/branch/<branch>`, authenticated with the workflow's OIDC token (`id-token: write`). `pull-requests: write` is for the sticky comment.
- `actions: read` matters only with `artifact-name`: `buildhost-publish-site` fetches the named artifact through the Actions REST API (`listWorkflowRunArtifacts` and `downloadArtifact`), and both calls require it.
- Fork PRs are skipped (they receive no OIDC token and cannot authenticate to buildhost).
