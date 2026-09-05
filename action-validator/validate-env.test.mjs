import assert from 'node:assert/strict';
import {test} from 'node:test';

import {findUndeclared} from './validate-env.mjs';

// The shape that took every repo in the org down: the `env:` binding the input
// to the variable went, the script that reads it stayed.
test('a read with no env: on the step is a finding', () => {
	const findings = findUndeclared(`
runs:
  using: composite
  steps:
    - id: gate
      shell: bash
      run: |
        set -euo pipefail
        if [ -n "$EXCLUDE" ]; then
          printf '%s\\n' "$EXCLUDE"
        fi
`);
	assert.equal(findings.length, 2);
	assert.equal(findings[0].name, 'EXCLUDE');
});

test('the same step with the env: back is clean', () => {
	const findings = findUndeclared(`
runs:
  using: composite
  steps:
    - id: gate
      shell: bash
      env:
        EXCLUDE: \${{ inputs.exclude }}
      run: |
        set -euo pipefail
        if [ -n "$EXCLUDE" ]; then
          printf '%s\\n' "$EXCLUDE"
        fi
`);
	assert.deepEqual(findings, []);
});

// Without `set -u` an unset variable is the empty string, which is a choice a
// script is allowed to make.
test('a script that never sets -u is not this rule', () => {
	const findings = findUndeclared(`
runs:
  using: composite
  steps:
    - shell: bash
      run: |
        echo "$WHATEVER"
`);
	assert.deepEqual(findings, []);
});

test('a name the script assigns first is declared', () => {
	const findings = findUndeclared(`
runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        submodules=''
        for path in $submodules; do echo "$path"; done
        printf '%s' "$submodules"
`);
	assert.deepEqual(findings, []);
});

test('the runner provides GITHUB_ and RUNNER_ without asking', () => {
	const findings = findUndeclared(`
runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        echo "ok" >> "$GITHUB_OUTPUT"
        mkdir -p "\${RUNNER_TEMP}/work"
`);
	assert.deepEqual(findings, []);
});

// A default is the other honest answer to this rule, so it must not be flagged.
test('a read that names its own default is safe', () => {
	const findings = findUndeclared(`
runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        echo "\${MAYBE:-}"
        echo "\${ALSO-fallback}"
        echo "\${EITHER:+set}"
`);
	assert.deepEqual(findings, []);
});

// ${#VAR} aborts under set -u exactly like $VAR does.
test('a length expansion is a read', () => {
	const findings = findUndeclared(`
runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        echo "\${#FILES}"
`);
	assert.equal(findings.length, 1);
	assert.equal(findings[0].name, 'FILES');
});

// A GitHub expression is substituted before bash runs, and an awk program in
// single quotes is literal text. Neither is a shell variable read.
test('expressions and single-quoted spans are not reads', () => {
	const findings = findUndeclared(`
runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        for f in \${{ inputs.actions }}; do echo "$f"; done
        awk '{print $NF}' /dev/null
`);
	assert.deepEqual(findings, []);
});

test('a step with no run: is skipped', () => {
	const findings = findUndeclared(`
runs:
  using: composite
  steps:
    - uses: wow-look-at-my/actions@run-once#latest
      with:
        name: common-checks
`);
	assert.deepEqual(findings, []);
});
