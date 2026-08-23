#!/usr/bin/env node
// The mechanism is only real while CI runs it. This asserts release.yml still
// carries the job that runs check-requests.mjs on every push.
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
if (!/^\s{2}requests:$/m.test(workflow)) {
	console.error('release.yml has no `requests:` job. Nothing runs the request checks.');
	process.exit(1);
}
if (!workflow.includes('node check-requests.mjs')) {
	console.error('release.yml never runs `node check-requests.mjs`.');
	process.exit(1);
}
if (/continue-on-error/.test(workflow.split(/^\s{2}requests:$/m)[1]?.split(/^\s{2}\w[\w-]*:$/m)[0] ?? '')) {
	console.error('the requests job carries continue-on-error, so it cannot fail the build.');
	process.exit(1);
}
console.log('release.yml runs the request checks and can fail on them');
