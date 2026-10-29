// A CommonJS `.ts` loader: CommonJS tries every registered extension, so "./helper" finds helper.ts.

import * as fs from 'fs';

interface CompilableModule {
	_compile(code: string, filename: string): void;
}

type ExtensionHandler = (module: CompilableModule, filename: string) => void;

// A CommonJS `.ts` loader: CommonJS tries every registered extension, so
// "./helper" finds helper.ts. The returned function restores the handler.
export function installTsLoader(transpile: (source: string, fileName: string) => string): () => void {
	const extensions = (require('module') as { _extensions: Record<string, ExtensionHandler | undefined> })._extensions;
	const previous = extensions['.ts'];
	extensions['.ts'] = (module, filename) => {
		module._compile(transpile(fs.readFileSync(filename, 'utf-8'), filename), filename);
	};
	return () => {
		if (previous) {
			extensions['.ts'] = previous;
			return;
		}
		delete extensions['.ts'];
	};
}
