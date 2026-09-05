// A path that carries its own CI must not be read twice. A submodule is the
// usual case, and a fixture that breaks the rules on purpose is the other one.
// The glob follows the rules the `files` input follows: `**` crosses a
// directory separator, `*` and `?` stay inside one path segment.

export function splitPatterns(value: string): string[] {
	return value
		.split(/[\n,]/)
		.map((entry) => entry.trim())
		.filter((entry) => entry !== '');
}

export function globToRegExp(glob: string): RegExp {
	let pattern = '';
	for (let index = 0; index < glob.length; index++) {
		const char = glob[index];
		if (char === '*') {
			if (glob[index + 1] === '*') {
				index++;
				if (glob[index + 1] === '/') {
					index++;
					pattern += '(?:.*/)?';
					continue;
				}
				pattern += '.*';
				continue;
			}
			pattern += '[^/]*';
			continue;
		}
		if (char === '?') {
			pattern += '[^/]';
			continue;
		}
		pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${pattern}$`);
}

// Reports whether a file matches one of the patterns. An empty input excludes
// nothing.
export function excluder(raw: string): (file: string) => boolean {
	const patterns = splitPatterns(raw).map(globToRegExp);
	return (file) => patterns.some((pattern) => pattern.test(file));
}
