# The README is generated from every action.yml in the repository, so it goes
# stale the moment an action is added, renamed, or given a new input. This is
# the assertion that catches that; release.yml only invokes it.
#
# generate-readme.sh writes to stdout and cds to its own directory, so it runs
# fine with the repository mounted read-only. The generated copy goes to
# {outputs.X}, which is the writable path under every sandbox backend.

tests:
	- desc: README.md matches what generate-readme.sh produces
	  cmd: './generate-readme.sh > {outputs.README.generated.md}; diff -u README.md {outputs.README.generated.md}'
	  timeout: 120s
	  outputs:
		files:
			README.generated.md:
				exists: true
