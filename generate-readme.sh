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
  using=$(yq -r '.runs.using' "$action_yml")

  echo ""
  echo "### [$name]($dir/)"
  echo ""
  echo "$desc."
  echo ""

  # Build usage block with required inputs
  echo '```yaml'
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

  # Show type badge
  case "$using" in
    composite) echo "" ; echo "Type: Composite" ;;
    node*)     echo "" ; echo "Type: Node.js ($using)" ;;
  esac

  # Add copyable setup command if README exists
  if [ -f "$dir/README.md" ]; then
    echo ""
    echo '```'
    echo "setup https://raw.githubusercontent.com/wow-look-at-my/actions/refs/heads/master/$dir/README.md"
    echo '```'
  fi
done
