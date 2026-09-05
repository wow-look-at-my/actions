import assert from 'node:assert/strict';
import {test} from 'node:test';
import {scanFile} from './scan';
import {blankExpressions, scanShell} from './shell';
import {envNames, findRunSteps, githubEnvNames, inputEnvNames} from './yaml';

function names(yaml: string): string[] {
	return scanFile(yaml).findings.map(finding => finding.name);
}

// The outage this check exists for: common-checks kept the script that reads
// $EXCLUDE after the input and the env that bound it were deleted, so the first
// job of every run in every Go repo in the org died on line 1.
const REGRESSION = `name: Common Checks
description: Run this org's checks once per workflow run

runs:
  using: composite
  steps:
    - id: gate
      shell: bash
      run: |
        set -euo pipefail

        extra=''
        if [ -n "$EXCLUDE" ]; then
          extra="$EXCLUDE"
        fi
        echo "$extra"
`;

test('the deleted input is caught where the script still reads it', () => {
	const scan = scanFile(REGRESSION);
	assert.deepEqual(
		scan.findings.map(finding => finding.name),
		['EXCLUDE']
	);
	// Line 13 of the file is the `if [ -n "$EXCLUDE" ]` line.
	assert.equal(scan.findings[0].line, 13);
});

test('the same step passes once its env binds the name', () => {
	const bound = REGRESSION.replace(
		'      shell: bash\n',
		"      shell: bash\n      env:\n        EXCLUDE: ${{ inputs.exclude }}\n"
	);
	assert.deepEqual(names(bound), []);
});

test('a default makes an unset name legal', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        echo "\${EXCLUDE:-}"
        echo "\${OTHER-fallback}"
        echo "\${THIRD:+set}"
`;
	assert.deepEqual(names(yaml), []);
});

test('a name the script assigns is its own', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        submodules=''
        for path in a b; do
          submodules="$submodules $path"
        done
        read -r first rest <<< "$submodules"
        echo "$first$rest"
`;
	assert.deepEqual(names(yaml), []);
});

test("a read flag's argument is not the name being read into", () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      env:
        INPUT_FILES: x
      run: |
        set -euo pipefail
        while IFS= read -r line; do
          echo "$line"
        done <<< "$INPUT_FILES"
        read -a parts -r <<< "a b"
        echo "\${parts[0]}"
`;
	assert.deepEqual(names(yaml), []);
});

test('the runner provides its own families', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        echo "$GITHUB_WORKSPACE $RUNNER_TEMP $ACTIONS_RUNTIME_URL $HOME $CI"
        echo "$1 $@ $? $# $$"
`;
	assert.deepEqual(names(yaml), []);
});

test("a composite action's inputs reach its steps as INPUT_*", () => {
	const yaml = `inputs:
  cache-key:
    required: false
    default: ''
runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        echo "$INPUT_CACHE_KEY"
`;
	assert.deepEqual(names(yaml), []);
	assert.ok(inputEnvNames(yaml).has('INPUT_CACHE_KEY'));
});

test('an earlier write to $GITHUB_ENV binds a later step', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      run: echo "TOOL_DIR=/opt/tool" >> "$GITHUB_ENV"
    - shell: bash
      run: |
        set -euo pipefail
        echo "$TOOL_DIR"
`;
	assert.deepEqual(names(yaml), []);
	assert.ok(githubEnvNames(yaml).has('TOOL_DIR'));
});

test('a heredoc writing $GITHUB_ENV binds its names too', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      run: |
        cat >> "$GITHUB_ENV" <<EOF
        FIRST=one
        SECOND=two
        EOF
    - shell: bash
      run: |
        set -euo pipefail
        echo "$FIRST $SECOND"
`;
	assert.deepEqual(names(yaml), []);
});

test('single quotes do not expand', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        echo '$NOT_A_REFERENCE'
        echo "it's a literal $REAL_ONE"
`;
	assert.deepEqual(names(yaml), ['REAL_ONE']);
});

test("a quoted heredoc delimiter turns expansion off, an unquoted one does not", () => {
	const quoted = `runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        cat <<'EOF'
        $LITERAL
        EOF
`;
	assert.deepEqual(names(quoted), []);

	const unquoted = quoted.replace("<<'EOF'", '<<EOF');
	assert.deepEqual(names(unquoted), ['LITERAL']);
});

test('a comment is not a reference', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        # $COMMENTED is not read
        echo ok
`;
	assert.deepEqual(names(yaml), []);
});

test('a step without nounset is not this rule', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      run: |
        echo "$WHATEVER"
`;
	assert.deepEqual(names(yaml), []);
});

test('a step that turns nounset back off is reported, not failed', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        set +u
        echo "$MAYBE"
`;
	const scan = scanFile(yaml);
	assert.deepEqual(scan.findings, []);
	assert.deepEqual(scan.skipped, [6]);
});

test('another shell is left alone', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: python
      run: |
        set -euo pipefail
        print("$NOT_SHELL")
`;
	assert.deepEqual(names(yaml), []);
});

test('a `${{ }}` expression is substituted before bash sees it', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        echo "\${{ inputs.value }}"
        echo "\${{ github.event.pull_request.head.sha }}"
`;
	assert.deepEqual(names(yaml), []);
	assert.equal(blankExpressions('a ${{ x }} b'), 'a xxxxxxxx b');
});

test('a workflow job env binds its steps', () => {
	const yaml = `on:
  push:
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      TOKEN: abc
    steps:
      - run: |
          set -euo pipefail
          echo "$TOKEN"
          echo "$UNDECLARED"
`;
	assert.deepEqual(names(yaml), ['UNDECLARED']);
	assert.ok(envNames(yaml).has('TOKEN'));
});

test('a command substitution is scanned as a script', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        echo "$(printf '%s' "$INNER")"
`;
	assert.deepEqual(names(yaml), ['INNER']);
});

test('arithmetic is not followed', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        count=1
        echo $((count + 1))
`;
	assert.deepEqual(names(yaml), []);
});

test('one name is reported once per step', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        echo "$SAME"
        echo "$SAME"
        echo "\${SAME}"
`;
	assert.deepEqual(names(yaml), ['SAME']);
});

test('a run block is bounded by its own step', () => {
	const yaml = `runs:
  using: composite
  steps:
    - shell: bash
      run: |
        set -euo pipefail
        echo ok
      env:
        UNUSED: 1
    - shell: bash
      run: |
        set -euo pipefail
        echo "$SECOND_ONLY"
`;
	const steps = findRunSteps(yaml);
	assert.equal(steps.length, 2);
	assert.ok(steps[0].stepEnv.has('UNUSED'));
	assert.deepEqual(names(yaml), ['SECOND_ONLY']);
});

test('nounset is recognised in every spelling it is written in', () => {
	for (const line of ['set -u', 'set -eu', 'set -euo pipefail', 'set -o nounset']) {
		assert.equal(scanShell(`${line}\necho "$X"`).nounset, true, line);
	}
	assert.equal(scanShell('set -e\necho "$X"').nounset, false);
});
