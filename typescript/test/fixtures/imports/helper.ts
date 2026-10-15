export interface Greeting {
	project: string;
	count: number;
}

export function greet(g: Greeting): string {
	return `${g.project}:${g.count}`;
}

export function projectInput(): string {
	return String(inputs.project ?? 'none');
}
