#!/usr/bin/env bash
set -euo pipefail

build_dir="build"
if [ ! -d "$build_dir" ]; then
  echo "::error::build/ directory not found in $(pwd)"
  exit 1
fi

# Discover binaries: find real files (not symlinks) matching *_linux_*
declare -A binaries  # binary_name -> space-separated archs
for f in "$build_dir"/*_linux_*; do
  [ -f "$f" ] || continue
  [ -L "$f" ] && continue
  base=$(basename "$f")
  # Extract name and arch from pattern: name_linux_arch
  name="${base%_linux_*}"
  arch="${base##*_linux_}"
  binaries[$name]+="${arch} "
done

if [ ${#binaries[@]} -eq 0 ]; then
  echo "::error::No Linux binaries found in $build_dir/"
  exit 1
fi

# Filter to requested binary if specified
if [ -n "$INPUT_BINARY" ]; then
  if [ -z "${binaries[$INPUT_BINARY]+x}" ]; then
    echo "::error::Binary '$INPUT_BINARY' not found. Available: ${!binaries[*]}"
    exit 1
  fi
  archs="${binaries[$INPUT_BINARY]}"
  unset binaries
  declare -A binaries
  binaries[$INPUT_BINARY]="$archs"
fi

echo "Discovered binaries:"
for name in "${!binaries[@]}"; do
  echo "  $name: ${binaries[$name]}"
done

multi_binary=false
if [ ${#binaries[@]} -gt 1 ]; then
  multi_binary=true
fi

for name in "${!binaries[@]}"; do
  # Determine image name
  if [ "$multi_binary" = true ]; then
    image="${INPUT_IMAGE}/${name}:${INPUT_TAG}"
  else
    image="${INPUT_IMAGE}:${INPUT_TAG}"
  fi

  read -ra arch_list <<< "${binaries[$name]}"
  platforms=""
  for arch in "${arch_list[@]}"; do
    platforms+="linux/${arch},"
  done
  platforms="${platforms%,}"

  echo "==> Building $image for $platforms"

  # Create a temp directory for the docker context
  ctx=$(mktemp -d)
  trap "rm -rf $ctx" EXIT

  # Copy the Dockerfile template
  cp "$ACTION_DIR/Dockerfile" "$ctx/Dockerfile"

  # Copy binaries into arch-specific dirs
  for arch in "${arch_list[@]}"; do
    mkdir -p "$ctx/$arch"
    cp "$build_dir/${name}_linux_${arch}" "$ctx/$arch/binary"
  done

  # Build and push multi-arch image (buildx --push is required for multi-platform)
  docker buildx build \
    --platform "$platforms" \
    --tag "$image" \
    --push \
    "$ctx"

  rm -rf "$ctx"
  trap - EXIT

  echo "==> Pushed $image"
done
