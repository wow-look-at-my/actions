# The guard's answer comes from the submodule's own history, so every case here
# builds a real superproject and a real submodule. make.sh names which commit
# each side of the superproject points at.
#
# The fixture's remotes are paths, and the action fetches from them, so the
# sandbox needs no network.

sandbox:
	network: false

tests:
	- desc: a gitlink that moves forward passes
	  exit: 0
	  cmd: w=$(sh submodule-gte/test/fixtures/make.sh forward) && env GITHUB_WORKSPACE="$w" INPUT_BASE=master node submodule-gte/dist/index.js

	- desc: a gitlink that moves backwards fails
	  exit: 1
	  cmd: w=$(sh submodule-gte/test/fixtures/make.sh backward) && env GITHUB_WORKSPACE="$w" INPUT_BASE=master node submodule-gte/dist/index.js

	- desc: the failure names the submodule and says which way it went
	  exit: 0
	  cmd: w=$(sh submodule-gte/test/fixtures/make.sh backward) && env GITHUB_WORKSPACE="$w" INPUT_BASE=master node submodule-gte/dist/index.js 2>&1 | grep -q 'sub: .* moves the submodule backwards'

	- desc: an unmoved gitlink passes
	  exit: 0
	  cmd: w=$(sh submodule-gte/test/fixtures/make.sh unmoved) && env GITHUB_WORKSPACE="$w" INPUT_BASE=master node submodule-gte/dist/index.js

	- desc: a gitlink on another line of history fails
	  exit: 1
	  cmd: w=$(sh submodule-gte/test/fixtures/make.sh unrelated) && env GITHUB_WORKSPACE="$w" INPUT_BASE=master node submodule-gte/dist/index.js

	- desc: a submodule the branch adds passes
	  exit: 0
	  cmd: w=$(sh submodule-gte/test/fixtures/make.sh added) && env GITHUB_WORKSPACE="$w" INPUT_BASE=master node submodule-gte/dist/index.js

	# A check that cannot check must not report success.
	- desc: a commit the submodule's origin does not serve fails
	  exit: 1
	  cmd: w=$(sh submodule-gte/test/fixtures/make.sh unreachable) && env GITHUB_WORKSPACE="$w" INPUT_BASE=master node submodule-gte/dist/index.js

	- desc: an excluded submodule is not checked, so a backwards move passes
	  exit: 0
	  cmd: w=$(sh submodule-gte/test/fixtures/make.sh backward) && env GITHUB_WORKSPACE="$w" INPUT_BASE=master INPUT_EXCLUDE=sub node submodule-gte/dist/index.js

	# Nothing else names the base branch off a pull request, and guessing one
	# compares against a ref nobody chose.
	- desc: no base ref and no pull request is an error
	  exit: 1
	  cmd: w=$(sh submodule-gte/test/fixtures/make.sh forward) && env GITHUB_WORKSPACE="$w" INPUT_BASE= GITHUB_BASE_REF= node submodule-gte/dist/index.js
