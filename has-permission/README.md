# has-permission

Report whether a permission is granted to the running job.

It reads the workflow file of the running workflow and resolves one scope the way GitHub does: the job's own `permissions:` block, and the workflow-level block when the job declares none. It never calls an API and never exercises the permission, so it costs nothing and cannot be fooled by an unrelated failure.

An action that needs `id-token: write` can use this to say so plainly, instead of failing several steps later inside a token request.

## Usage

```yaml
steps:
  - uses: actions/checkout@v4
  - id: oidc
    uses: wow-look-at-my/actions@has-permission#latest
    with:
      permission: id-token
  - if: steps.oidc.outputs.granted != 'true'
    run: echo "::error::this job needs id-token: write"
```

The workflow file must be checked out. The action reads it from `GITHUB_WORKSPACE`.

## The Rule

A job block replaces the workflow block outright. GitHub does not merge them, so a job that declares `permissions: { contents: read }` loses every other scope the workflow granted. A block that omits a scope grants that scope nothing, and `permissions: {}` grants nothing at all.

`write` satisfies a request for `read`. `read` does not satisfy a request for `write`.

A workflow with no block anywhere leaves the scope at the repository default, which the file does not state. That case reports `granted: false` with `source: default` and a warning. Declare the block to get a true answer.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `permission` | Yes | | Scope to look for, such as `id-token`, `contents` or `packages`. |
| `level` | No | `write` | Level the caller needs: `read`, `write` or `none`. |
| `workflow` | No | *(running workflow)* | Workflow file to read, relative to the workspace. |
| `job` | No | *(running job)* | Job id to read. |

## Outputs

| Name | Description |
|------|-------------|
| `granted` | `true` when the job holds the permission at the requested level. |
| `level` | Level the resolved block gives: `none`, `read` or `write`. |
| `source` | Block the level came from: `job`, `workflow` or `default`. |
