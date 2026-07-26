# artifact-storage-record

Records where a build artifact is stored on GitHub's [artifact metadata
API](https://docs.github.com/en/rest/orgs/artifact-metadata), so it shows up on
the organization's linked artifacts page tied back to the repo and commit that
produced it. Registry-agnostic — buildhost, GHCR, Artifactory, anything with a
URL and a digest.

```yml
permissions:
  artifact-metadata: write

steps:
  - uses: wow-look-at-my/actions@artifact-storage-record#latest
    with:
      name: myapp
      version: v3
      digest: ${{ steps.build.outputs.sha256 }}
      registry-url: https://pazer.build
      artifact-url: https://dl.pazer.build/myapp?v=v3&os=linux&arch=amd64
```

## Batch mode

Pass a JSON array as `records` to post several artifacts in one step (each
element takes the same keys in snake_case). The scalar inputs are ignored when
it is set.

```yml
  - uses: wow-look-at-my/actions@artifact-storage-record#latest
    with:
      records: ${{ steps.publish.outputs.storage_records }}
```

## Notes

- **Permissions.** Needs `artifact-metadata: write`. A job-level `permissions:`
  block *replaces* the workflow-level one, so add it alongside whatever the job
  already needs. Without it the step emits one warning and stays green —
  bookkeeping must never fail the publish it belongs to. Set `on-error: fail`
  if you would rather have it red.
- **The digest and the URL must agree.** `artifact-url` should serve exactly
  the bytes `digest` covers. A registry that transforms artifacts on download
  (repackaging, stripping) needs the URL of the untransformed original, or no
  URL at all — a record pointing at bytes that hash to something else is worse
  than no record.
- A bare 64-character hex digest is accepted and normalized to `sha256:<hex>`.
- Records are never cleaned up by this action. If the registry evicts an
  artifact, post `status: eol` or `deleted` for the same digest.
