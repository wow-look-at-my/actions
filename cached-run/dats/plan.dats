# plan.sh turns the action's inputs into a cache key. The key decides which runs
# share a cache, so getting it wrong serves one command's output to another.
# This runs it directly, with no runner and no network.
sandbox:
	network: false

shared:
	files:
		# plan runs plan.sh the way the composite step does, with GITHUB_OUTPUT
		# pointed at a scratch file, then prints that file. get reads one scalar
		# key back out of it.
		lib.sh: |
			set -uo pipefail

			plan() {
			  local out
			  out="$(mktemp)"
			  GITHUB_OUTPUT="$out" \
			  RUNNER_TEMP="${RUNNER_TEMP:-/tmp}" \
			  RUNNER_OS_NAME="${RUNNER_OS_NAME:-Linux}" \
			  RUNNER_ARCH_NAME="${RUNNER_ARCH_NAME:-X64}" \
			    bash "$PLAN" > /dev/null 2>&1 || { echo "PLAN_FAILED"; return 1; }
			  cat "$out"
			}

			get() {
			  grep "^$1=" | head -n1 | cut -d= -f2-
			}

			# Names the absence instead of returning empty, so two failed plans
			# never compare equal to each other.
			key_of() {
			  local k
			  k="$(plan | get key)"
			  echo "${k:-ABSENT}"
			}

tests:
	- desc: "the same script and paths produce the same key twice"
	  exit: 0
	  inputs:
		files:
			run.sh: |
				. {shared.lib.sh}
				export RUN_SCRIPT='make build' RAW_PATHS='build/' EXTRA_KEY=''
				a="$(key_of)"
				b="$(key_of)"
				if [ "$a" = "$b" ]; then
				  echo "STABLE=yes"
				else
				  echo "STABLE=no ($a vs $b)"
				fi
				case "$a" in
				  cached-run-v1-Linux-X64-*) echo "PREFIX=ok" ;;
				  *) echo "PREFIX=bad:$a" ;;
				esac
	  cmd: env PLAN="$PWD/cached-run/plan.sh" bash {inputs.run.sh}
	  outputs:
		stdout:
			- "STABLE=yes"
			- "PREFIX=ok"

	- desc: "one changed character in the script changes the key"
	  exit: 0
	  inputs:
		files:
			run.sh: |
				. {shared.lib.sh}
				export RAW_PATHS='build/' EXTRA_KEY=''
				a="$(RUN_SCRIPT='make build' key_of)"
				b="$(RUN_SCRIPT='make build ' key_of)"
				if [ "$a" = "$b" ]; then
				  echo "DISTINCT=no"
				else
				  echo "DISTINCT=yes"
				fi
	  cmd: env PLAN="$PWD/cached-run/plan.sh" bash {inputs.run.sh}
	  outputs:
		stdout:
			- "DISTINCT=yes"

	- desc: "adding a path changes the key, and reordering the paths does not"
	  exit: 0
	  inputs:
		files:
			run.sh: |
				. {shared.lib.sh}
				export RUN_SCRIPT='make build' EXTRA_KEY=''
				one="$(RAW_PATHS='build/' key_of)"
				two="$(RAW_PATHS="$(printf 'build/\ndist/')" key_of)"
				flipped="$(RAW_PATHS="$(printf 'dist/\nbuild/')" key_of)"
				if [ "$one" = "$two" ]; then
				  echo "ADDED_PATH_IGNORED=yes"
				else
				  echo "ADDED_PATH_CHANGES_KEY=yes"
				fi
				if [ "$two" = "$flipped" ]; then
				  echo "ORDER_IRRELEVANT=yes"
				else
				  echo "ORDER_IRRELEVANT=no"
				fi
	  cmd: env PLAN="$PWD/cached-run/plan.sh" bash {inputs.run.sh}
	  outputs:
		stdout:
			- "ADDED_PATH_CHANGES_KEY=yes"
			- "ORDER_IRRELEVANT=yes"

	- desc: "the os and arch are part of the key, so no runner reads another's cache"
	  exit: 0
	  inputs:
		files:
			run.sh: |
				. {shared.lib.sh}
				export RUN_SCRIPT='make build' RAW_PATHS='build/' EXTRA_KEY=''
				linux="$(RUNNER_OS_NAME=Linux RUNNER_ARCH_NAME=X64 key_of)"
				mac="$(RUNNER_OS_NAME=macOS RUNNER_ARCH_NAME=X64 key_of)"
				arm="$(RUNNER_OS_NAME=Linux RUNNER_ARCH_NAME=ARM64 key_of)"
				if [ "$linux" = "$mac" ]; then
				  echo "OS_IGNORED=yes"
				else
				  echo "OS_IN_KEY=yes"
				fi
				if [ "$linux" = "$arm" ]; then
				  echo "ARCH_IGNORED=yes"
				else
				  echo "ARCH_IN_KEY=yes"
				fi
	  cmd: env PLAN="$PWD/cached-run/plan.sh" bash {inputs.run.sh}
	  outputs:
		stdout:
			- "OS_IN_KEY=yes"
			- "ARCH_IN_KEY=yes"

	- desc: "the paths output is trimmed, deduplicated and sorted"
	  exit: 0
	  inputs:
		files:
			run.sh: |
				. {shared.lib.sh}
				export RUN_SCRIPT='make build'
				export RAW_PATHS="$(printf '  dist/  \n\nbuild/\ndist/\n')"
				export EXTRA_KEY=''
				plan | sed -n '/^paths<</,/^CACHED_RUN_PATHS$/p' | grep -v CACHED_RUN_PATHS | sed 's/^/PATH:/'
	  cmd: env PLAN="$PWD/cached-run/plan.sh" bash {inputs.run.sh}
	  outputs:
		stdout:
			- "PATH:build/"
			- "PATH:dist/"

	- desc: "an empty paths input fails loudly instead of caching nothing quietly"
	  exit: 0
	  inputs:
		files:
			run.sh: |
				. {shared.lib.sh}
				export RUN_SCRIPT='make build' RAW_PATHS='   ' EXTRA_KEY=''
				plan || true
	  cmd: env PLAN="$PWD/cached-run/plan.sh" bash {inputs.run.sh}
	  outputs:
		stdout:
			- "PLAN_FAILED"

	- desc: "an empty run input fails loudly, because a composite runner does not enforce required"
	  exit: 0
	  inputs:
		files:
			run.sh: |
				. {shared.lib.sh}
				export RUN_SCRIPT='   ' RAW_PATHS='build/' EXTRA_KEY=''
				plan || true
	  cmd: env PLAN="$PWD/cached-run/plan.sh" bash {inputs.run.sh}
	  outputs:
		stdout:
			- "PLAN_FAILED"

	- desc: "the extra key separates two callers running the identical script"
	  exit: 0
	  inputs:
		files:
			run.sh: |
				. {shared.lib.sh}
				export RUN_SCRIPT='make build' RAW_PATHS='build/'
				a="$(EXTRA_KEY='alpha' key_of)"
				b="$(EXTRA_KEY='beta' key_of)"
				if [ "$a" = "$b" ]; then
				  echo "EXTRA_IGNORED=yes"
				else
				  echo "EXTRA_IN_KEY=yes"
				fi
				case "$a" in
				  *-alpha-*) echo "LABEL=readable" ;;
				  *) echo "LABEL=missing:$a" ;;
				esac
	  cmd: env PLAN="$PWD/cached-run/plan.sh" bash {inputs.run.sh}
	  outputs:
		stdout:
			- "EXTRA_IN_KEY=yes"
			- "LABEL=readable"

	- desc: "a key label with characters a cache key rejects is sanitized"
	  exit: 0
	  inputs:
		files:
			run.sh: |
				. {shared.lib.sh}
				export RUN_SCRIPT='make build' RAW_PATHS='build/'
				k="$(EXTRA_KEY='node, v22 / ubuntu' key_of)"
				case "$k" in
				  *,*) echo "COMMA=present" ;;
				  *) echo "COMMA=absent" ;;
				esac
				case "$k" in
				  *" "*) echo "SPACE=present" ;;
				  *) echo "SPACE=absent" ;;
				esac
				echo "KEY=$k"
	  cmd: env PLAN="$PWD/cached-run/plan.sh" bash {inputs.run.sh}
	  outputs:
		stdout:
			- "COMMA=absent"
			- "SPACE=absent"
			- "KEY=cached-run-v1-Linux-X64-node-v22-ubuntu-"

	- desc: "the sentinel path is derived from the digest, so two runs in one job do not share one"
	  exit: 0
	  inputs:
		files:
			run.sh: |
				. {shared.lib.sh}
				export RAW_PATHS='build/' EXTRA_KEY=''
				a="$(RUN_SCRIPT='make build' plan | get sentinel)"
				b="$(RUN_SCRIPT='make test' plan | get sentinel)"
				if [ "$a" = "$b" ]; then
				  echo "SENTINEL_SHARED=yes"
				else
				  echo "SENTINEL_PER_RUN=yes"
				fi
	  cmd: env PLAN="$PWD/cached-run/plan.sh" bash {inputs.run.sh}
	  outputs:
		stdout:
			- "SENTINEL_PER_RUN=yes"
