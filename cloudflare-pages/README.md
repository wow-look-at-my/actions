# Cloudflare Pages

Publish a directory to [Cloudflare Pages](https://developers.cloudflare.com/pages/) by **direct upload** (`wrangler pages deploy`) — no Actions artifacts (the org's artifact storage budget is $0), no Cloudflare git integration. The Pages project is auto-created on first use.

## Usage

```yaml
permissions:
  id-token: write   # required — credentials come from secret-server via OIDC
  contents: read

steps:
  - uses: actions/checkout@v4
  # ... build/stage the site into a directory ...
  - uses: wow-look-at-my/actions@cloudflare-pages#latest
    with:
      directory: _site
      project-name: my-project
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `directory` | Built/staged directory to upload | Yes | |
| `project-name` | Cloudflare Pages project name (auto-created on first use) | Yes | |
| `branch` | Deployment branch; empty = the current `github.ref_name`. A deploy whose branch equals the project's production branch is a production deployment, anything else is a preview | No | `''` |
| `production-branch` | Production branch used when auto-creating the project | No | `master` |
| `missing-credentials` | How to treat absent Cloudflare credentials: `warn` = loud green no-op (warning annotation + step summary), `fail` = red | No | `warn` |

## Credentials (secret-server, not Actions secrets)

The action fetches `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` from [secret-server](https://secrets.pazer.io) using GitHub Actions OIDC — there are **no GitHub Actions secrets to configure**. The caller must grant `permissions: id-token: write` (without it the secret-server fetch step fails). Entitlement is configured server-side: an unentitled workflow identity gets `200 {}` and exports nothing, which by default makes the deploy step a **loud green no-op** (warning annotation + step summary) rather than a red build — so wiring the action up before the entitlement exists can never break a repo's `all-builds` gate. Set `missing-credentials: fail` once the entitlement is in place if you'd rather a lost credential turn the build red.

## Production vs preview

`wrangler pages deploy --branch <branch>` decides: a deploy whose branch equals the project's **production branch** is a production deployment; any other branch is a preview deployment with its own URL. By default the action deploys as the current `github.ref_name`, so a master push is production (given the default `production-branch: master`) and any other branch is a preview.

## Guards

- The deploy refuses (red) when `directory` is missing or empty — an empty site is never uploaded.
- `wrangler pages project create` is attempted first and its failure is treated as "project already exists"; the deploy itself is what must succeed.
