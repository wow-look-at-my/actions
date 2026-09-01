# push-excludes-tags

Fail CI when a workflow's `push` trigger names no ref filter.

A `push:` with no `branches`, `branches-ignore`, `tags`, or `tags-ignore` matches every ref. A release that pushes a tag therefore starts the whole workflow a second time, on the same commit that just passed it.

## Usage

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: wow-look-at-my/actions@push-excludes-tags#latest
```

It is one of the checks [common-checks](../common-checks/) runs, so a repository using that action needs no step of its own.

## The Rule

Every `.github/workflows/*.yml` of the checked-out repository is read. A workflow whose triggers are `on: push`, `on: [push, ...]`, a bare `push:`, or a `push:` naming only `paths` fails the step.

Naming `tags:` passes: that workflow asks for tag pushes on purpose. Naming `branches: ['**']` passes and runs on every branch push, which is what a validation workflow wants.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `exclude` | No | *(empty)* | Glob patterns for workflow files the scan skips, newline or comma separated. Use this for fixtures that break the rule on purpose. |
