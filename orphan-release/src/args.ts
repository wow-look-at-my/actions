export type Options = {
	source: string;
	name: string;
	version: string;
	exclude: string;
	message: string;
	includeBranch: boolean;
};

// One flag per option, each taking its value as the next argv element, so a
// value that contains a space arrives whole.
export function parseArgs(argv: string[]): Options {
	const options: Options = { source: "", name: "", version: "", exclude: "", message: "", includeBranch: false };
	const takesValue: Record<string, keyof Options> = {
		"--source": "source",
		"--name": "name",
		"--version": "version",
		"--exclude": "exclude",
		"--message": "message",
	};

	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i]!;
		if (flag === "--include-branch") {
			options.includeBranch = true;
			continue;
		}
		const key = takesValue[flag];
		if (key === undefined) throw new Error(`Unknown option: ${flag}`);
		const value = argv[++i];
		if (value === undefined) throw new Error(`${flag} needs a value`);
		(options[key] as string) = value;
	}

	if (options.source === "") throw new Error("Error: --source is required");
	// Guards against garbage from an upstream lookup (yq prints "null" for a
	// missing field), which used to mint a tag like "name#null".
	if (options.version !== "" && !/^[0-9]+$/.test(options.version)) {
		throw new Error(`Error: --version must be a positive integer, got '${options.version}'`);
	}
	if (options.name === "") options.name = options.source;
	return options;
}

export function isDefaultBranch(branch: string): boolean {
	return branch === "master" || branch === "main";
}

// A branch-qualified prefix keeps a side branch's numbers out of the shared
// series. The default branch owns the unqualified one.
export function tagPrefix(name: string, branch: string, includeBranch: boolean): string {
	return includeBranch && !isDefaultBranch(branch) ? `${name}/${branch}` : name;
}

// The highest number already published under this prefix. A tag carrying
// anything but digits after the "#" belongs to another series.
export function nextVersion(tags: string[], prefix: string): number {
	const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}#([0-9]+)$`);
	let max = 0;
	for (const tag of tags) {
		const match = pattern.exec(tag.trim());
		if (match === null) continue;
		max = Math.max(max, Number(match[1]));
	}
	return max + 1;
}
