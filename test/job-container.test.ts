import { before, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { DIST, execFileAsync, runAction } from './run-action';

// A job container sees the runner's _actions tree under another root than the
// host path that ${{ github.action_path }} expands to.
describe('host action paths in a job container', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-container-'));
	const containerActions = path.join(tmp, 'container', '_actions');
	const dist = path.join(containerActions, 'wow-look-at-my', 'actions', 'typescript#latest', 'dist', 'index.js');
	const hostLib = path.join(tmp, 'host', '_work', '_actions', 'acme', 'tool', 'master', 'step', '..', 'lib', 'm');
	const script = `const { hello } = require(${JSON.stringify(`${hostLib}.ts`)}) as typeof import(${JSON.stringify(hostLib)});\ncore.info("mapped:" + hello());`;

	before(() => {
		fs.cpSync(path.dirname(DIST), path.dirname(dist), { recursive: true });
		const lib = path.join(containerActions, 'acme', 'tool', 'master', 'lib');
		fs.mkdirSync(path.join(containerActions, 'acme', 'tool', 'master', 'step'), { recursive: true });
		fs.mkdirSync(lib, { recursive: true });
		fs.writeFileSync(path.join(lib, 'm.ts'), 'export function hello(): string { return "hi"; }\n');
	});

	it('type-checks and requires the file through the container _actions root', async () => {
		const { stdout, exitCode } = await execFileAsync('node', [dist], {
			env: { ...process.env, INPUT_SCRIPT: script },
			timeout: 15000,
		}).then((r) => ({ stdout: r.stdout, exitCode: 0 }), (e: { stdout?: string; code?: number }) => ({ stdout: e.stdout ?? '', exitCode: e.code ?? 1 }));
		assert.equal(exitCode, 0, stdout);
		assert.ok(stdout.includes('mapped:hi'), stdout);
	});

	it('fails with TS2307 when the action does not run from an _actions tree', async () => {
		const { stdout, exitCode } = await runAction(script);
		assert.equal(exitCode, 1, stdout);
		assert.ok(stdout.includes('TS2307'), stdout);
	});
});
