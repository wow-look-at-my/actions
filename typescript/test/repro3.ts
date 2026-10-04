// repro3.ts -- dogfood test for the typescript action, run in CI via: uses: ./typescript with: file.

const { data } = await octokit.rest.repos.get(context.repo);

const expected = `${context.repo.owner}/${context.repo.repo}`;
core.info(`octokit.rest.repos.get -> ${data.full_name} (expected ${expected})`);

if (data.full_name !== expected) {
	throw new Error(`octokit.rest.repos.get returned '${data.full_name}', expected '${expected}'`);
}

core.info('repro3 OK: injected octokit was authenticated with the default github-token');
