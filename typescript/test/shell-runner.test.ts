import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { runAction } from './run-action';

describe('$ command runner', () => {
	it('resolves to a ProcessOutput with stdout, stderr, and exitCode', async () => {
		const { stdout, exitCode } = await runAction(`
			const arg = "hello world";
			const r = await $\`echo \${arg}\`;
			core.info("stdout=" + JSON.stringify(r.stdout));
			core.info("stderr=" + JSON.stringify(r.stderr));
			core.info("exitCode=" + r.exitCode);
		`);
		assert.equal(exitCode, 0);
		// echo appends a trailing newline; stdout is the raw, untrimmed stream.
		assert.ok(stdout.includes('stdout="hello world\\n"'), stdout);
		assert.ok(stdout.includes('stderr=""'));
		assert.ok(stdout.includes('exitCode=0'));
	});

	it('toString() trims a single trailing newline while stdout stays raw', async () => {
		const { stdout, exitCode } = await runAction(`
			const arg = "trim-me";
			const r = await $\`echo \${arg}\`;
			core.info("toString=[" + r.toString() + "]");
			core.info("raw=" + JSON.stringify(r.stdout));
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('toString=[trim-me]'), stdout);
		assert.ok(stdout.includes('raw="trim-me\\n"'), stdout);
	});

	it('string-coerces to trimmed stdout inside a template literal', async () => {
		const { stdout, exitCode } = await runAction(`
			const arg = "abc";
			core.info(\`coerced=\${await $\`echo \${arg}\`}\`);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('coerced=abc'), stdout);
	});

	it('captures stdout via destructuring (the headline one-liner)', async () => {
		const { stdout, exitCode } = await runAction(`
			const { stdout: out } = await $\`echo \${"captured"}\`;
			core.info("cap=" + out.trim());
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('cap=captured'), stdout);
	});

	it('stdout.json() parses the captured JSON (trailing newline tolerated)', async () => {
		const { stdout, exitCode } = await runAction(`
			const payload = JSON.stringify({ a: 1, b: ["x", "y"] });
			const code = "process.stdout.write(process.argv[1])";
			const r = await $\`node -e \${code} \${payload}\`;
			const data = r.stdout.json() as { a: number; b: string[] };
			core.info("json=" + data.a + ":" + data.b.join(","));
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('json=1:x,y'), stdout);
	});

	it('stdout.json() accepts a type parameter', async () => {
		const { stdout, exitCode } = await runAction(`
			const payload = JSON.stringify({ version: "1.2.3", count: 5 });
			const code = "process.stdout.write(process.argv[1])";
			const r = await $\`node -e \${code} \${payload}\`;
			const data = r.stdout.json<{ version: string; count: number }>();
			core.info("typed=" + data.version + "/" + (data.count + 1));
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('typed=1.2.3/6'), stdout);
	});

	it('stderr.json() parses the captured stderr too', async () => {
		const { stdout, exitCode } = await runAction(`
			const code = "process.stderr.write(JSON.stringify({ err: true }))";
			const r = await $\`node -e \${code}\`;
			core.info("stderr-json=" + r.stderr.json<{ err: string }>().err);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('stderr-json=true'), stdout);
	});

	it('a stream still behaves as a string (methods, coercion, JSON.stringify)', async () => {
		// The .json() helper rides on a boxed String; ordinary string usage must
		// keep working. (Strict === against a literal is the documented exception.)
		const { stdout, exitCode } = await runAction(`
			const { stdout: out } = await $\`echo \${"hello world"}\`;
			core.info("trim=" + out.trim());
			core.info("split=" + out.trim().split(" ").length);
			core.info("includes=" + out.includes("world"));
			core.info("concat=" + ("[" + out.trim() + "]"));
			core.info("stringify=" + JSON.stringify(out));
			const asString: string = out;            // assignable to string
			core.info("len=" + asString.length);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('trim=hello world'), stdout);
		assert.ok(stdout.includes('split=2'), stdout);
		assert.ok(stdout.includes('includes=true'), stdout);
		assert.ok(stdout.includes('concat=[hello world]'), stdout);
		assert.ok(stdout.includes('stringify="hello world\\n"'), stdout);
	});

	it('builder.json() is a paren-free shortcut (no `(await ...)` needed)', async () => {
		const { stdout, exitCode } = await runAction(`
			const payload = JSON.stringify({ ok: true, n: 41 });
			const code = "process.stdout.write(process.argv[1])";
			const data = await $\`node -e \${code} \${payload}\`.json<{ ok: boolean; n: number }>();
			core.info("paren-free=" + data.ok + ":" + (data.n + 1));
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('paren-free=true:42'), stdout);
	});

	it('builder.json() accepts a type parameter', async () => {
		const { stdout, exitCode } = await runAction(`
			const payload = JSON.stringify({ version: "9.9.9" });
			const code = "process.stdout.write(process.argv[1])";
			const data = await $\`node -e \${code} \${payload}\`.json<{ version: string }>();
			core.info("typed-shortcut=" + data.version);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('typed-shortcut=9.9.9'), stdout);
	});

	it('builder.text() resolves to trimmed stdout paren-free', async () => {
		const { stdout, exitCode } = await runAction(`
			const sha = await $\`echo \${"deadbeef"}\`.text();
			core.info("text=[" + sha + "]");
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('text=[deadbeef]'), stdout);
	});

	it('builder.json() composes with modifiers chained before it', async () => {
		const { stdout, exitCode } = await runAction(`
			const code = "process.stdout.write(JSON.stringify({ v: process.env.MYVAR }))";
			const data = await $\`node -e \${code}\`.env({ MYVAR: "via-env" }).json<{ v: string }>();
			core.info("composed=" + data.v);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('composed=via-env'), stdout);
	});

	it('await $`...`.stdout.json() works directly — no `(await ...)` wrapper', async () => {
		const { stdout, exitCode } = await runAction(`
			const payload = JSON.stringify({ ok: true, n: 7 });
			const code = "process.stdout.write(process.argv[1])";
			const data = await $\`node -e \${code} \${payload}\`.stdout.json<{ ok: boolean; n: number }>();
			core.info("lazy-stdout-json=" + data.ok + ":" + data.n);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('lazy-stdout-json=true:7'), stdout);
	});

	it('await $`...`.stderr.json() works directly too', async () => {
		const { stdout, exitCode } = await runAction(`
			const code = "process.stderr.write(JSON.stringify({ warn: 3 }))";
			const data = await $\`node -e \${code}\`.stderr.json<{ warn: number }>();
			core.info("lazy-stderr-json=" + data.warn);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('lazy-stderr-json=3'), stdout);
	});

	it('await $`...`.stdout resolves to the raw stream (untrimmed, still .json()-able)', async () => {
		const { stdout, exitCode } = await runAction(`
			const out = await $\`echo \${"raw-line"}\`.stdout;
			core.info("raw=" + JSON.stringify(out));   // keeps the trailing newline
			core.info("trimmed=" + out.trim());
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('raw="raw-line\\n"'), stdout);
		assert.ok(stdout.includes('trimmed=raw-line'), stdout);
	});

	it('await $`...`.stdout.text() trims; .stdout.json() composes with modifiers', async () => {
		const { stdout, exitCode } = await runAction(`
			const sha = await $\`echo \${"v2"}\`.stdout.text();
			core.info("lazy-text=[" + sha + "]");
			const code = "process.stdout.write(JSON.stringify({ home: process.env.HOMEVAR }))";
			const data = await $\`node -e \${code}\`.env({ HOMEVAR: "set" }).stdout.json<{ home: string }>();
			core.info("lazy-composed=" + data.home);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('lazy-text=[v2]'), stdout);
		assert.ok(stdout.includes('lazy-composed=set'), stdout);
	});

	it('throws on a non-zero exit by default', async () => {
		const { stdout, exitCode } = await runAction(`
			const code = "process.exit(3)";
			await $\`node -e \${code}\`;
			core.info("should-not-reach");
		`);
		assert.notEqual(exitCode, 0);
		assert.ok(stdout.includes('exit code 3'), stdout);
		assert.ok(!stdout.includes('should-not-reach'), stdout);
	});

	it('the thrown error carries captured stdout/stderr/exitCode', async () => {
		const { stdout, exitCode } = await runAction(`
			const code = "process.stdout.write('O');process.stderr.write('E');process.exit(1)";
			try {
				await $\`node -e \${code}\`;
				core.info("no-throw");
			} catch (e: any) {
				core.info("caught=" + e.exitCode + "|" + e.stdout + "|" + e.stderr);
			}
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('caught=1|O|E'), stdout);
	});

	it('.nothrow() resolves on a non-zero exit so the caller reads exitCode', async () => {
		const { stdout, exitCode } = await runAction(`
			const code = "process.exit(7)";
			const r = await $\`node -e \${code}\`.nothrow();
			core.info("nothrow-code=" + r.exitCode);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('nothrow-code=7'), stdout);
	});

	it('.env() merges over the process env (override applied, PATH preserved)', async () => {
		const { stdout, exitCode } = await runAction(`
			const code = "process.stdout.write((process.env.MYVAR || '?') + ':' + (process.env.PATH ? 'haspath' : 'nopath'))";
			const r = await $\`node -e \${code}\`.env({ MYVAR: "from-env" });
			core.info("env=" + r.stdout);
		`);
		assert.equal(exitCode, 0);
		// from-env proves the override; haspath proves it merged rather than replaced.
		assert.ok(stdout.includes('env=from-env:haspath'), stdout);
	});

	it('passes each interpolated value as exactly one argument (no shell split)', async () => {
		const { stdout, exitCode } = await runAction(`
			const code = "process.stdout.write(process.argv.length + '|' + process.argv[1])";
			const arg = "a b c";
			const r = await $\`node -e \${code} \${arg}\`;
			core.info("argv=" + r.stdout);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('argv=2|a b c'), stdout);
	});

	it('expands an array interpolation to multiple arguments', async () => {
		const { stdout, exitCode } = await runAction(`
			const code = "process.stdout.write(process.argv.length + ':' + process.argv.slice(1).join(','))";
			const flags = ["x", "y", "z"];
			const r = await $\`node -e \${code} \${flags}\`;
			core.info("arr=" + r.stdout);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('arr=4:x,y,z'), stdout);
	});

	it('skips a falsy interpolation (conditional flag)', async () => {
		const { stdout, exitCode } = await runAction(`
			const code = "process.stdout.write(String(process.argv.length))";
			const verbose = false;
			const r = await $\`node -e \${code} \${verbose && "-v"}\`;
			core.info("falsy=" + r.stdout);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('falsy=1'), stdout);
	});

	it('.input() pipes data to stdin', async () => {
		const { stdout, exitCode } = await runAction(`
			const r = await $\`cat\`.input("piped-data");
			core.info("input=" + r.stdout);
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('input=piped-data'), stdout);
	});

	it('.cwd() sets the working directory', async () => {
		const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ts-dollar-cwd-')));
		try {
			const { stdout, exitCode } = await runAction(`
				const code = "process.stdout.write(process.cwd())";
				const r = await $\`node -e \${code}\`.cwd(${JSON.stringify(dir)});
				core.info("cwd=" + r.stdout);
			`);
			assert.equal(exitCode, 0);
			assert.ok(stdout.includes('cwd=' + dir), stdout);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it('.silent() captures output without streaming it to the log', async () => {
		const { stdout, exitCode } = await runAction(`
			const arg = "shh";
			const r = await $\`echo \${arg}\`.silent();
			core.info("silent-captured=" + r.toString());
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('silent-captured=shh'), stdout);
		// Silent suppresses both the "[command]" echo and the streamed stdout.
		assert.equal(stdout.split('shh').length - 1, 1, `expected 'shh' exactly once, got:\n${stdout}`);
	});

	it('chains modifiers, preserving earlier options (input survives a later .silent())', async () => {
		const { stdout, exitCode } = await runAction(`
			const r = await $\`cat\`.input("chained").silent();
			core.info("chain=" + r.toString());
		`);
		assert.equal(exitCode, 0);
		assert.ok(stdout.includes('chain=chained'), stdout);
	});
});
