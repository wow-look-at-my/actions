import * as core from '@actions/core';
import {plan} from './plan';

try {
	const result = plan(process.env);
	core.setOutput('key', result.key);
	core.setOutput('digest', result.digest);
	core.setOutput('sentinel', result.sentinel);
	core.setOutput('paths', result.paths.join('\n'));
	core.info(`cached-run key: ${result.key}`);
	core.info(`cached-run paths:\n${result.paths.join('\n')}`);
} catch (error) {
	core.setFailed(`cached-run: ${error instanceof Error ? error.message : String(error)}`);
}
