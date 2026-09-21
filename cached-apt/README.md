# cached-apt

Install apt packages on a Linux runner from a cache of the files they dropped. On a cache hit the action extracts one tarball and runs `ldconfig`. It never calls apt at all.

This is the apt-specialized sibling of `cached-run`. That action caches the declared output paths of a command you write. This one discovers the paths itself, from the packages apt installed.

## Use

```yaml
- uses: wow-look-at-my/actions@cached-apt#latest
  with:
    packages: |
      libsdl2-dev
      ninja-build
      pkg-config
```

Separate packages with whitespace, newlines or commas. The list is sorted and deduped before it reaches the key. Any ordering of one set therefore shares one cache entry.

| Input | Meaning |
| --- | --- |
| `packages` | Required. The apt packages to install. |
| `key` | Extra text mixed into the cache key. Change it to discard every existing entry. |

| Output | Meaning |
| --- | --- |
| `cache-hit` | `true` when the files came from the cache. |
| `installed-packages` | The packages the cache holds, including the dependencies apt pulled in. |
| `skipped` | `true` when the runner is not Linux, so nothing was installed. |

On a runner that is not Linux the action installs nothing and succeeds. A cross-platform matrix therefore calls it with no `if:` guard. It is not silent about it. A notice names the platform, and `skipped` reads `true`.

## How it works

The cache key is `cached-apt-v1-<os id>-<os version>-<arch>[-<key label>]-<sha256 prefix>`. The digest covers the action version, the sorted package list, the OS id and version, the dpkg architecture and your `key`. It does not cover the apt sources or `apt-get update` state. Those move on their own and miss the cache on every run.

On a miss the action records the installed-package set. It then runs `apt-get update` and `apt-get install`. It records the set again and diffs it. The diff gives the requested packages plus every dependency apt pulled in. For each one `dpkg-query -L` gives the paths. The action keeps the files and the symlinks. It drops the directories and the paths the image excluded. It packs the rest into a tarball and saves that to the cache.

The action saves the cache only after `apt-get install` exits 0. There is no post step. A failed install therefore leaves no half-populated tarball behind for later runs.

## Limitations, which are real

**dpkg does not know the packages are installed.** The action restores files, not packages. It does not capture or restore the dpkg database. A later `apt-get install` of a dependent package downloads and installs the restored package again.

**Maintainer scripts do not run.** A restore skips `postinst`, `update-alternatives`, systemd unit enablement and every dpkg trigger. The action runs `ldconfig` itself. Nothing else runs.

**Directory metadata is not preserved.** The tarball holds files and symlinks only. tar recreates any missing parent directory at mode 0755, owned by root.

This action therefore suits build and test dependencies. Headers, libraries, compilers and command-line tools all work. A package that registers a service, adds a user or owns an alternative does not. Use plain `apt-get install` for those.

**A hit pins you to the version the first run installed.** The key names the package list, not the versions apt resolved. A later security update therefore does not reach a job whose key still hits. Change the `key` input to discard the entries. You can also pin the version yourself. `curl=7.81.0-1ubuntu1.15` is a valid entry in `packages`. A changed pin is a changed key.

**Nothing new to cache is not an error.** Sometimes every requested package is already on the runner image. Then apt installs nothing, the action saves no cache and a notice says so. Every later run repeats the apt call.
