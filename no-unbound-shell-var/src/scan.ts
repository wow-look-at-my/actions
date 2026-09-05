import {scanShell} from './shell';
import {envNames, findRunSteps, githubEnvNames, inputEnvNames} from './yaml';

export interface Finding {
	line: number;
	name: string;
}

// The runner sets these in every step. see README.md
const RUNNER_ENV = new Set([
	'CI',
	'HOME',
	'PATH',
	'PWD',
	'SHELL',
	'SHLVL',
	'TERM',
	'TMPDIR',
	'USER',
	'LANG',
	'LC_ALL',
	'HOSTNAME',
	'OSTYPE',
	'BASH',
	'BASH_VERSION',
	'BASH_SOURCE',
	'BASHPID',
	'BASH_REMATCH',
	'FUNCNAME',
	'PIPESTATUS',
	'RANDOM',
	'SECONDS',
	'LINENO',
	'REPLY',
	'OPTARG',
	'OPTIND',
	'IFS',
	'PS1',
	'PS2',
	'PS4',
	'EDITOR',
	'GOPATH',
	'GOROOT',
	'JAVA_HOME',
	'ANDROID_HOME',
	'DOTNET_ROOT',
	'AGENT_TOOLSDIRECTORY',
	'IMAGE_OS',
	'IMAGE_VERSION',
	'DEPLOYMENT_BASEPATH',
	'CONDA',
	'VCPKG_INSTALLATION_ROOT',
	'SWIFT_PATH',
	'CHROME_BIN',
	'CHROMEWEBDRIVER',
	'GECKOWEBDRIVER',
	'EDGEWEBDRIVER',
	'SELENIUM_JAR_PATH',
	'LEIN_HOME',
	'LEIN_JAR',
	'PIPX_HOME',
	'PIPX_BIN_DIR',
	'NVM_DIR',
	'HOMEBREW_CELLAR',
	'HOMEBREW_PREFIX',
	'HOMEBREW_REPOSITORY'
]);

// A prefixed family the runner sets, or that a step's own tooling exports.
const RUNNER_PREFIXES = ['GITHUB_', 'RUNNER_', 'ACTIONS_', 'INPUT_'];

function isRunnerProvided(name: string): boolean {
	return RUNNER_ENV.has(name) || RUNNER_PREFIXES.some(prefix => name.startsWith(prefix));
}

// Only bash reads `set -u`. A step with no `shell:` runs bash on Linux and macOS
// and pwsh on Windows, so an unmarked step is checked: the script says `set -u`,
// which is a bash script whatever the runner is.
function isBash(shell: string | undefined): boolean {
	if (shell === undefined) {
		return true;
	}
	return /^(?:bash|sh)\b/.test(shell);
}

export interface FileScan {
	findings: Finding[];
	// A step that turns nounset back off. The scan cannot tell which references
	// it still covers, so it reports the skip instead of guessing.
	skipped: number[];
}

export function scanFile(content: string): FileScan {
	const bound = new Set<string>([...envNames(content), ...inputEnvNames(content), ...githubEnvNames(content)]);
	const findings: Finding[] = [];
	const skipped: number[] = [];

	for (const step of findRunSteps(content)) {
		if (!isBash(step.shell)) {
			continue;
		}
		const shell = scanShell(step.script);
		if (!shell.nounset) {
			continue;
		}
		if (shell.nounsetOff) {
			skipped.push(step.startLine);
			continue;
		}
		const seen = new Set<string>();
		for (const ref of shell.refs) {
			if (seen.has(ref.name)) {
				continue;
			}
			if (bound.has(ref.name) || step.stepEnv.has(ref.name) || shell.assigned.has(ref.name) || isRunnerProvided(ref.name)) {
				continue;
			}
			seen.add(ref.name);
			findings.push({line: step.startLine + ref.line - 1, name: ref.name});
		}
	}

	return {findings, skipped};
}

export function formatFinding(file: string, finding: Finding): string {
	return [
		`${file}:${finding.line}: $${finding.name} is read under \`set -u\`, and nothing in this file gives it a value.`,
		`  The step dies with "${finding.name}: unbound variable" before it runs. Bind it in the step's \`env:\`, or write \`\${${finding.name}:-}\` to accept it being unset.`
	].join('\n');
}
