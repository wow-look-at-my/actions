import fs from 'node:fs';
import path from 'node:path';
import {lintFiles, hasFailures} from './src/lint';

const root = process.argv[2];
const files: {name: string; text: string}[] = [];
(function walk(dir: string) {
	for (const name of fs.readdirSync(dir).sort()) {
		if (name === '.git' || name === '.github' || name === 'node_modules') continue;
		const p = path.join(dir, name);
		if (fs.statSync(p).isDirectory()) walk(p);
		else if (p.endsWith('.md')) files.push({name: path.relative(root, p), text: fs.readFileSync(p, 'utf8')});
	}
})(root);
const f = lintFiles(files);
for (const [k,v] of Object.entries(f)) if (Array.isArray(v)) console.log(`${k}: ${v.length}`);
console.log("HARDFAIL", hasFailures(f));
console.error(`${f.bannedModals.length} modal hits in ${files.length} files`);
