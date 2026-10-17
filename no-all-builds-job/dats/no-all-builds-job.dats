# The guard has several layers, and each one must be driven separately.
# They are the file scan, the API layers, and the run-once sentinel.
# release.yml used to spell these out as separate bash steps.

sandbox:
	network: false

tests:
	- desc: the file scan fails on a workflow whose job is named all-builds
	  exit: 1
	  cmd: env NO_ALL_BUILDS_JOB_ALREADY_RAN= GITHUB_WORKSPACE="$PWD/no-all-builds-job/test/fixtures/shadowed" INPUT_TOKEN= node no-all-builds-job/dist/index.js

	- desc: a layer that cannot scan is a blocking error, never a pass
	  exit: 1
	  cmd: env NO_ALL_BUILDS_JOB_ALREADY_RAN= INPUT_TOKEN=x node no-all-builds-job/dist/index.js

	- desc: the sentinel skips the guard before the shadowed fixture is read
	  exit: 0
	  cmd: env NO_ALL_BUILDS_JOB_ALREADY_RAN=1 GITHUB_WORKSPACE="$PWD/no-all-builds-job/test/fixtures/shadowed" INPUT_TOKEN=x node no-all-builds-job/dist/index.js
