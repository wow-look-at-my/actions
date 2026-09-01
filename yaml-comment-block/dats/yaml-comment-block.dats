# Both directions of the limit: a wall of comment lines fails, and a block
# sitting exactly at the maximum passes. release.yml used to spell these out
# as three bash steps.

sandbox:
	network: false

tests:
	- desc: a wall of consecutive comment lines fails the check
	  exit: 1
	  cmd: env GITHUB_WORKSPACE="$PWD/yaml-comment-block/test/fixtures/wall" node yaml-comment-block/dist/index.js

	- desc: a comment block at the limit passes
	  exit: 0
	  cmd: env GITHUB_WORKSPACE="$PWD/yaml-comment-block/test/fixtures/clean" node yaml-comment-block/dist/index.js
