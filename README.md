# GitHub Repository Settings Template

A template for managing GitHub repository settings as code using the [Probot Settings app](https://probot.github.io/apps/settings/).

## Overview

This template provides a `.github/settings.yml` configuration file that automatically syncs repository settings when changes are pushed. It enables infrastructure-as-code for your GitHub repositories.

## Features

- Repository metadata (description, topics, visibility)
- Issue and PR labels with colors and descriptions
- Branch protection rules
- Team and collaborator permissions
- Merge strategies configuration
- Security settings (vulnerability alerts, automated fixes)

## Usage

1. Install the [Settings app](https://github.com/apps/settings) on your repository
2. Copy `.github/settings.yml` to your repository
3. Customize the settings for your project
4. Push changes - settings sync automatically

## Configuration

Edit `.github/settings.yml` to customize:

| Section | Description |
|---------|-------------|
| `repository` | Name, description, visibility, features |
| `labels` | Issue/PR labels with colors |
| `milestones` | Project milestones |
| `collaborators` | Individual user permissions |
| `teams` | Team-based access control |
| `branches` | Branch protection rules |

## Branch Protection

The template includes sensible defaults for the `master` branch:

- Requires 1 approving review
- Dismisses stale reviews on new commits
- Requires code owner review
- Enforces linear history
- Applies to administrators

## License

MIT
