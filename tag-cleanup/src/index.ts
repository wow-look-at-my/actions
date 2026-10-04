import * as core from '@actions/core';
import { run } from './cleanup';

// The sweep itself lives in cleanup.ts, which exports it and runs nothing on
// import.
run({ cwd: '.', dryRun: core.getBooleanInput('dry-run') }).catch((err: unknown) => {
	core.setFailed(err instanceof Error ? err.message : String(err));
});
