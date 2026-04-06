# GHCR Push

## Overview

Composite action that pushes a container image to GHCR and prunes old versions. Composes three steps:

1. `ghcr/steps/login` — docker login to GHCR
2. `ghcr/steps/push` — docker push the image
3. `ghcr/steps/prune` — prune old tagged versions and orphaned untagged versions

## Key Details

- This is a convenience wrapper. Each step can be used independently.
- `prune: false` enables dry-run mode (logs what would be deleted)

## See Also

- `ghcr/steps/prune/` — Node.js action with the pruning logic
