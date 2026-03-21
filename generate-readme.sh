#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cat <<'HEADER'
# GitHub Actions

Reusable GitHub Actions.

## Actions
HEADER

for action_yml in */action.yml; do
  dir=$(dirname "$action_yml")
  name=$(yq -r '.name' "$action_yml")
  desc=$(yq -r '.description' "$action_yml")

  echo ""
  echo "### [$name]($dir/)"
  echo ""
  echo '```'

  echo "# $desc."
  if [ -f "$dir/README.md" ]; then
    echo "# Docs: https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/$dir/README.md"
  fi
  echo "- uses: wow-look-at-my/actions@${dir}#latest"

  # Get required inputs as newline-separated keys
  required_keys=$(yq -r '.inputs // {} | to_entries[] | select(.value.required == true) | .key' "$action_yml")

  if [ -n "$required_keys" ]; then
    echo "  with:"
    while IFS= read -r key; do
      [ -z "$key" ] && continue
      desc_input=$(yq -r ".inputs.\"$key\".description" "$action_yml")
      echo "    $key: # $desc_input"
    done <<< "$required_keys"
  fi

  echo '```'
done
