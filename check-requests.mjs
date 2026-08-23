#!/usr/bin/env node
// Every instruction the owner gives becomes a row in requests.json, and every
// row names a command that proves the instruction was carried out. This script
// runs those commands. A row with no proof, a failing proof, or a status that
// is not "done" fails CI. see docs/requests.md
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(root, 'requests.json');

let rows;
try {
	rows = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
	console.error(`::error::requests.json is unreadable: ${error.message}`);
	process.exit(1);
}
if (!Array.isArray(rows) || rows.length === 0) {
	console.error('::error::requests.json must be a non-empty array');
	process.exit(1);
}

const seen = new Set();
let failures = 0;

for (const row of rows) {
	const id = typeof row?.id === 'string' ? row.id : '';
	if (!id) {
		console.error('::error::a row has no id');
		failures++;
		continue;
	}
	if (seen.has(id)) {
		console.error(`::error::${id}: duplicate id`);
		failures++;
	}
	seen.add(id);

	if (typeof row.request !== 'string' || row.request.trim() === '') {
		console.error(`::error::${id}: no request text, so nothing states what was asked`);
		failures++;
		continue;
	}
	if (typeof row.proof !== 'string' || row.proof.trim() === '') {
		console.error(`::error::${id}: no proof command. An instruction with no check is an instruction nobody can show was carried out`);
		failures++;
		continue;
	}
	if (row.status !== 'done') {
		console.error(`::error::${id}: status is "${row.status}", not "done". ${row.request}`);
		failures++;
		continue;
	}

	try {
		execSync(row.proof, {cwd: root, stdio: 'pipe', shell: '/bin/bash'});
		console.log(`ok   ${id}: ${row.proof}`);
	} catch (error) {
		const out = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
		console.error(`::error::${id}: proof failed (${row.proof})\n${out}`);
		failures++;
	}
}

if (failures > 0) {
	console.error(`::error::${failures} request(s) are unproven out of ${rows.length}`);
	process.exit(1);
}
console.log(`all ${rows.length} request(s) proven`);
