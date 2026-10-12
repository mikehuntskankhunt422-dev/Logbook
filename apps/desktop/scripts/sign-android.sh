#!/usr/bin/env bash
# Signs the Android app (D90): aligns the unsigned APK the build made and signs it with the key in
# ANDROID_KEYSTORE_BASE64 (a PKCS12 keystore, base64-encoded), its password in
# ANDROID_KEYSTORE_PASSWORD and its alias in ANDROID_KEY_ALIAS (default "logbook").
#
#   apps/desktop/scripts/sign-android.sh <unsigned.apk> <signed.apk>
#
# Android installs an update only when it's signed with the same key as the app already there, so
# every release must use this one key, forever: losing it means people can't update without
# uninstalling, which deletes their journal. A release runs this in the `sign` job, on a fresh
# machine where nothing from the project's dependencies has run, with the tools that come with the
# machine (Android's build-tools). Branch builds run it with a throwaway key, so it's tried on every
# push. Without a key it says so and stops without failing: the release then has no APK.
set -euo pipefail

unsigned="$1"
signed="$2"
if [ -z "${ANDROID_KEYSTORE_BASE64:-}" ] || [ -z "${ANDROID_KEYSTORE_PASSWORD:-}" ]; then
  echo "::warning::No Android signing key (ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD): this release has no Android app. docs/DEVELOPING.md says how to make the key."
  exit 0
fi
alias="${ANDROID_KEY_ALIAS:-logbook}"

# The newest build-tools on the machine (zipalign -P needs 35 or later).
tools="$(ls -d "${ANDROID_HOME:?ANDROID_HOME is not set}"/build-tools/* | sort -V | tail -1)"
echo "Using $tools"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$work/key.p12"

# Native libraries on 16 KB page boundaries, which Android 15 and later phones need.
echo "Aligning $unsigned"
"$tools/zipalign" -f -P 16 4 "$unsigned" "$work/aligned.apk"
echo "Signing"
"$tools/apksigner" sign --ks "$work/key.p12" --ks-type PKCS12 --ks-pass env:ANDROID_KEYSTORE_PASSWORD \
  --ks-key-alias "$alias" --out "$signed" "$work/aligned.apk"
echo "Checking"
"$tools/apksigner" verify --print-certs "$signed"
echo "Signed $signed."
