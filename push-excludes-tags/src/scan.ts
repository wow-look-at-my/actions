import {LineCounter, isMap, isScalar, isSeq, parseDocument} from 'yaml';

// A push filter that names none of these matches every ref, tags included.
export const FILTER_KEYS = ['branches', 'branches-ignore', 'tags', 'tags-ignore'];

export type Violation = {
	file: string;
	line: number;
	detail: string;
};

function triggerNode(root: unknown): unknown {
	if (!isMap(root)) {
		return undefined;
	}
	// YAML 1.1 readers fold the key `on` to the boolean true. The parser here
	// keeps it a string, so both spellings are looked up.
	return root.get('on', true) ?? root.get(true as never, true);
}

function lineOf(counter: LineCounter, offset: number | undefined): number {
	if (offset === undefined) {
		return 1;
	}
	return counter.linePos(offset).line;
}

export function scanWorkflow(file: string, content: string): Violation[] {
	const counter = new LineCounter();
	const doc = parseDocument(content, {lineCounter: counter});
	const triggers = triggerNode(doc.contents);
	if (triggers === undefined || triggers === null) {
		return [];
	}

	// `on: push` and `on: [push, ...]` carry no filter at all.
	if (isScalar(triggers)) {
		if (triggers.value !== 'push') {
			return [];
		}
		return [{file, line: lineOf(counter, triggers.range?.[0]), detail: '`on: push` names no filter'}];
	}
	if (isSeq(triggers)) {
		const push = triggers.items.find(item => isScalar(item) && item.value === 'push');
		if (push === undefined) {
			return [];
		}
		return [{file, line: lineOf(counter, (push as {range?: [number, number, number]}).range?.[0]), detail: '`push` in the trigger list names no filter'}];
	}
	if (!isMap(triggers)) {
		return [];
	}

	const pair = triggers.items.find(item => isScalar(item.key) && item.key.value === 'push');
	if (pair === undefined) {
		return [];
	}
	const line = lineOf(counter, (pair.key as {range?: [number, number, number]}).range?.[0]);
	const filter = pair.value;
	if (filter === null || filter === undefined) {
		return [{file, line, detail: 'bare `push:` names no filter'}];
	}
	if (!isMap(filter)) {
		return [{file, line, detail: '`push:` names no filter'}];
	}
	const named = filter.items.filter(item => isScalar(item.key) && FILTER_KEYS.includes(String(item.key.value)));
	if (named.length > 0) {
		return [];
	}
	return [{file, line, detail: `\`push:\` names none of ${FILTER_KEYS.join(', ')}`}];
}

export function formatViolation(violation: Violation): string {
	return `${violation.file}:${violation.line}: ${violation.detail}, so every tag push starts this workflow again. Add \`branches: ['**']\` under \`push:\` (or \`tags-ignore: ['**']\`) to keep it on branch pushes.`;
}
