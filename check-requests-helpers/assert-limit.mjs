#!/usr/bin/env node
// The comment limit is one line, and no action input can raise it.
import fs from 'node:fs';

const scan = fs.readFileSync(new URL('../yaml-comment-block/src/scan.ts', import.meta.url), 'utf8');
const match = /export const MAX_COMMENT_LINES = (\d+);/.exec(scan);
if (!match) {
	console.error('MAX_COMMENT_LINES is gone from yaml-comment-block/src/scan.ts');
	process.exit(1);
}
if (match[1] !== '1') {
	console.error(`MAX_COMMENT_LINES is ${match[1]}, not 1`);
	process.exit(1);
}

const action = fs.readFileSync(new URL('../yaml-comment-block/action.yml', import.meta.url), 'utf8');
for (const name of ['max', 'limit', 'max-comment-lines', 'max_lines']) {
	if (new RegExp(`^\\s{2}${name}:`, 'm').test(action)) {
		console.error(`yaml-comment-block/action.yml declares an input "${name}". A settable maximum removes the rule.`);
		process.exit(1);
	}
}
console.log('limit is 1 and no input raises it');
