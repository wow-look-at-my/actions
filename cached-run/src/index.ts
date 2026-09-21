import * as core from '@actions/core';
import {plan} from './plan';
import {saveGate} from './save_gate';

try {
	const result = plan(process.env);
	core.setOutput('key', result.key);
	core.setOutput('digest', result.digest);
	core.setOutput('sentinel', result.sentinel);
	core.setOutput('paths', result.paths.join('\n'));
	core.setOutput('envdir', result.envDir);
	core.setOutput('cache-paths', result.cachePaths.join('\n'));
	core.info(`cached-run key: ${result.key}`);
	core.info(`cached-run paths:\n${result.paths.join('\n')}`);

	const gate = saveGate(process.env);
	core.setOutput('save-allowed', String(gate.allowed));
	if (gate.reason !== '') {
		// A ref that is simply not the default one is the policy working rather
		// than a fault, so it is reported and not warned about.
		const report = gate.isWarning ? core.warning : core.info;
		report(`cached-run: ${gate.reason}`);
	}
} catch (error) {
	core.setFailed(`cached-run: ${error instanceof Error ? error.message : String(error)}`);
}
