#!/usr/bin/env bash
# Signs the files the updater installs (D88): the NSIS setup, the zipped macOS app, the AppImage,
# the deb and the rpm in <folder>, each bound to <version>, with the key in
# TAURI_SIGNING_PRIVATE_KEY (and TAURI_SIGNING_PRIVATE_KEY_PASSWORD).
#
#   apps/desktop/scripts/sign-updates.sh <folder> <version>
#
# The release workflow runs it in a job of its own on a fresh machine, where nothing from the
# project's dependencies has run. Tauri's CLI comes from the registry into an empty npm cache, from
# an empty folder, so no copy left in a cache or the checkout can stand in for it. Branch builds run
# it with a throwaway key, so it's tried on every push.
set -euo pipefail

folder="$1"
version="$2"
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "::error::No updater signing key: add TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD as secrets (docs/DEVELOPING.md)."
  exit 1
fi
# A path Windows programs read too (pwd -W in Git Bash).
folder="$(cd "$folder" && (pwd -W 2>/dev/null || pwd))"
work="$(mktemp -d)"
export npm_config_cache="$work/npm-cache"
cd "$work"

signed=0
for f in "$folder"/*-setup.exe "$folder"/*.app.tar.gz "$folder"/*.AppImage "$folder"/*.deb "$folder"/*.rpm; do
  [ -e "$f" ] || continue
  # --app-version puts the version inside what's signed, so a feed can't pair this file with
  # another version number (a downgrade).
  npx --yes @tauri-apps/cli@2.12.0 signer sign --app-version "$version" "$f" > /dev/null
  signed=$((signed + 1))
done
echo "Signed $signed update files for $version."
[ "$signed" -gt 0 ]
