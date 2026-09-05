import assert from 'node:assert/strict';
import {test} from 'node:test';
import {excluder, globToRegExp, splitPatterns} from './exclude';

test('patterns are newline or comma separated, and blank entries drop out', () => {
	assert.deepEqual(splitPatterns('a/**\nb/**'), ['a/**', 'b/**']);
	assert.deepEqual(splitPatterns(' a/** , b/** '), ['a/**', 'b/**']);
	assert.deepEqual(splitPatterns(''), []);
	assert.deepEqual(splitPatterns('\n , \n'), []);
});

test('a double star crosses a directory separator, a single star does not', () => {
	assert.match('vendor/docs/api.md', globToRegExp('vendor/**'));
	assert.match('vendor/api.md', globToRegExp('vendor/**'));
	assert.match('docs/api.md', globToRegExp('**/*.md'));
	assert.match('api.md', globToRegExp('**/*.md'));
	assert.doesNotMatch('docs/api.md', globToRegExp('*.md'));
});

test('a dot is a literal character, not a wildcard', () => {
	assert.doesNotMatch('READMExmd', globToRegExp('README.md'));
});

// The gate in common-checks writes one `<path>/**` line per submodule, so this
// is the shape the action gets in CI.
test('a submodule path excludes every file under it', () => {
	const skip = excluder('sub/**\nother/**');
	assert.equal(skip('sub/README.md'), true);
	assert.equal(skip('sub/docs/deep/note.md'), true);
	assert.equal(skip('other/README.md'), true);
	assert.equal(skip('README.md'), false);
	assert.equal(skip('substitute/README.md'), false);
});

test('an empty input excludes nothing', () => {
	const skip = excluder('');
	assert.equal(skip('README.md'), false);
});
