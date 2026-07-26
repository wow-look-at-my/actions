To opt in to instant docker-updater notifications after a push (recommended for private images, which don't emit GitHub package webhooks), pass the secret. The URL defaults to `https://docker-updater-hook.pazer.io/`:

```yml
jobs:
  publish-ghcr:
    uses: wow-look-at-my/actions/.github/workflows/publish-ghcr.yml@master
    secrets:
      updater-webhook-secret: ${{ secrets.DOCKER_UPDATER_WEBHOOK_SECRET }}
```

Set `DOCKER_UPDATER_WEBHOOK_SECRET` (same value as docker-updater's `DOCKER_UPDATER_GITHUB_WEBHOOK_SECRET`) at the org level. Callers that omit the secret get today's behavior unchanged.
