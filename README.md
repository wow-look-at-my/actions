# Fetch Secrets

A composite GitHub Action that fetches secrets from a self-hosted secret server using GitHub Actions OIDC, exports them as masked environment variables, and returns them as a JSON output.

## How It Works

1. Requests a GitHub OIDC token for the current workflow run (requires `id-token: write` permission).
2. Sends the token to the secret server's `/github/v1/secrets` endpoint.
3. The server validates the token's repository / ref / actor claims against configured policies and returns the matching secrets.
4. Each returned secret is registered with `::add-mask::`, exported as an env var, and also returned as a JSON object via the `secrets` output.

## Usage

```yaml
permissions:
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: wow-look-at-my/actions@secret-server#latest
        id: secrets

      # Secrets are now available as env vars
      - run: echo "Deploying with $DB_URL"
```

### Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `url` | No | `https://secrets.pazer.io` | Secret server URL |
| `audience` | No | _(defaults to `url`)_ | OIDC audience for the secret server |

### Outputs

| Name | Description |
|------|-------------|
| `secrets` | JSON object mapping secret names to values. All values are auto-masked in logs. |

## Requirements

- The workflow must have `permissions: id-token: write` so the runner can mint an OIDC token.
- The consuming repository / ref / actor must match a policy configured on the secret server, otherwise the server returns zero secrets.
