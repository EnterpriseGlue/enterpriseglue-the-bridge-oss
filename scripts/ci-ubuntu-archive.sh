#!/usr/bin/env bash
set -euo pipefail

mirror_list=${1:-/etc/apt/apt-mirrors.txt}
azure_mirror='^http://azure\.archive\.ubuntu\.com/ubuntu/?([[:space:]]|$)'
ubuntu_archive='^https://archive\.ubuntu\.com/ubuntu/?([[:space:]]|$)'

if [[ -f "$mirror_list" ]] && grep -Eq "$azure_mirror" "$mirror_list"; then
  # GitHub's Ubuntu runner already lists Canonical's HTTPS archive. Drop the
  # stalled HTTP mirror while keeping the remaining order and APT trust roots.
  if ! grep -Eq "$ubuntu_archive" "$mirror_list"; then
    echo 'The Ubuntu runner mirror list is missing the HTTPS package archive.' >&2
    exit 1
  fi
  mirrors=$(sed -E "\%$azure_mirror%d" "$mirror_list")
  printf '%s\n' "$mirrors" > "$mirror_list"
fi
