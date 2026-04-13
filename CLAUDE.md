# GHCR Push

## Overview

Composite action that pushes a container image to GHCR and prunes old versions. Composes three steps:

1. `ghcr-login` — docker login to GHCR via secret-server OIDC
2. `docker push` — push the image (inline step)
3. `ghcr-prune` — prune old tagged versions and orphaned untagged versions

## Key Details

- This is a convenience wrapper. Login and prune can be used independently.
- `prune: false` enables dry-run mode (logs what would be deleted)

## See Also

- `ghcr-prune/` — Node.js action with the pruning logic
