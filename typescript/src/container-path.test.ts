import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { actionsRoot, containerPath } from './container-path';

const ROOT = '/__w/_actions';
const HOST = '/home/runner/_work/_actions/acme/tool/master/lib/m.ts';
const MAPPED = '/__w/_actions/acme/tool/master/lib/m.ts';

describe('actionsRoot', () => {
	it('cuts the path after the _actions directory', () => {
		assert.equal(actionsRoot('/__w/_actions/wow/actions/typescript#latest/dist'), ROOT);
	});
	it('is undefined outside an _actions tree', () => {
		assert.equal(actionsRoot('/home/user/actions/typescript/dist'), undefined);
	});
});

describe('containerPath', () => {
	it('keeps a path that exists', () => {
		assert.equal(containerPath(HOST, ROOT, (p) => p === HOST || p === MAPPED), HOST);
	});
	it('moves a missing host path onto the container _actions root', () => {
		assert.equal(containerPath(HOST, ROOT, (p) => p === MAPPED), MAPPED);
	});
	it('keeps the path when the mapped path does not exist either', () => {
		assert.equal(containerPath(HOST, ROOT, () => false), HOST);
	});
	it('keeps the path when the action runs outside an _actions tree', () => {
		assert.equal(containerPath(HOST, undefined, (p) => p === MAPPED), HOST);
	});
	it('keeps a path that is not under _actions', () => {
		const p = '/home/runner/_work/repo/x.ts';
		assert.equal(containerPath(p, ROOT, (q) => q !== p), p);
	});
});
