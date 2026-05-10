#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cat <<'HEADER'
# GitHub Actions

Reusable GitHub Actions.

## Actions
HEADER

while IFS= read -r action_yml; do
  dir=$(dirname "$action_yml")
  name=$(yq -r '.name' "$action_yml")
  desc=$(yq -r '.description' "$action_yml")

  echo ""
  echo "### [$name]($dir/)"
  echo ""
  echo '```yml'

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
done < <(find . -name action.yml -not -path './.github/*' -not -path '*/test/*' -printf '%P\n' | sort)

# Reusable workflows (workflow_call triggers in .github/workflows/)
first_wf=true
while IFS= read -r wf; do
  has_call=$(yq -r '."on".workflow_call // empty' ".github/workflows/$wf")
  [ -z "$has_call" ] && continue

  if $first_wf; then
    echo ""
    echo "## Reusable Workflows"
    first_wf=false
  fi

  name=$(yq -r '.name' ".github/workflows/$wf")

  echo ""
  echo "### $name"
  echo ""
  echo '```yml'
  echo "jobs:"
  echo "  ${wf%.yml}:"
  echo "    uses: wow-look-at-my/actions/.github/workflows/${wf}@master"
  echo '```'
done < <(find .github/workflows -maxdepth 1 -name '*.yml' -printf '%f\n' | sort)
