# Developing Logbook

Everything needed to run, test, build and release Logbook. The user-facing overview is in the [README](../README.md); the reasons behind the design are in [DECISIONS.md](DECISIONS.md), and each milestone's report is in `docs/M*.md`.

## Setup

- **Node.js 24** or later, with npm.
- **Rust** (stable) for the desktop app. On Linux, Tauri's libraries too: `libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`. Windows needs the Microsoft C++ build tools; macOS needs Xcode's command-line tools.
- **Chromium for Playwright**, once: `npx playwright install chromium` in `apps/web` (tests). To use another Chromium build, set `LOGBOOK_CHROMIUM_PATH`.

```bash
npm install
```

## Running it

```bash
npm run desktop                      # the desktop app in a window, with hot reload (Vite on port 5174)
npm run dev                          # the same screens in a browser, at http://localhost:5173
```

The browser build (`npm run build`, then `npm run preview` at http://localhost:4173) isn't published (D78); it's how the Playwright tests run the screens, with the journal in IndexedDB instead of a folder. `vite build --mode desktop` (`npm run build:desktop -w @logbook/web`) is the bundle the desktop app loads: no service worker, the journal folder instead of IndexedDB, and the desktop-only code that the browser build leaves out.

The desktop app's first run asks where to keep the journal (`Documents/Logbook` by default). Its config file, which remembers the folder, is in the OS's app config folder under `app.logbookjournal.desktop`. Delete it to see the first run again.

## Checking it

```bash
npm run lint
npm run typecheck
npm test               # unit tests (Vitest): core, both storage packages, the app's own
npm run test:e2e       # Playwright on the browser build: desktop and mobile Chromium, with axe accessibility checks
npm run lhci           # Lighthouse CI against apps/web/dist (needs Chrome or Edge; set CHROME_PATH on Windows)
```

The desktop app's own checks, in `apps/desktop`:

```bash
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cd ..
npx tauri build --debug --no-bundle    # the app, without installers
xvfb-run -a npm run test:e2e           # Linux: drives the app through WebDriver (M5 §1.2)
```

The smoke test needs `tauri-driver` (`cargo install tauri-driver --version =2.0.6 --locked`), WebKitWebDriver (`webkit2gtk-driver` on Ubuntu) and `python3-xlib`. It starts the app in a fresh home folder, chooses the default journal folder, writes an entry with a photo, checks the files on disk, restarts and checks again, then types an entry and closes the window at once, as the close button does, to check it was saved.

CI (`.github/workflows/ci.yml`) runs all of this on pull requests and on `main`, including the desktop smoke test.

## Installers and releases

```bash
npm run desktop:build    # installers for this computer's OS, in apps/desktop/src-tauri/target/release/bundle/
```

`.github/workflows/desktop-release.yml` builds the installers on GitHub's runners: NSIS (`.exe`) on Windows, a universal `.dmg` on macOS, and AppImage, `.deb` and `.rpm` on Ubuntu 22.04 (an older Ubuntu, so the AppImage runs on more distributions). It runs on every push to a `claude/**` branch that touches the app, leaving the installers as workflow artifacts to try, and on every `v*` tag, when it also publishes them as a GitHub release with `SHA256SUMS.txt`.

To release a version:

1. Set the version in `apps/desktop/package.json` (`0.1.1`; numbers only, no `-beta` suffix). `tauri.conf.json` and the version written into backups both read it from there.
2. Write what changed in `apps/desktop/RELEASE-NOTES.md`; it becomes the release's description.
3. Either push a tag `v<version>`, or run the **Desktop installers** workflow by hand on `main` (Actions → Desktop installers → Run workflow) with the version; that run makes the tag itself (D87). Either way the workflow refuses a version that doesn't match `apps/desktop/package.json`. `0.x` versions say "preview" in the title but aren't GitHub pre-releases, because the updater reads the release GitHub calls latest (D88).

**Automatic updates (D88).** A release also carries `latest.json` and signed update files; installed copies find it within 12 hours, or at once through Settings → Updates → Check for updates. Signing needs the repository secrets `TAURI_SIGNING_PRIVATE_KEY` (the whole contents of the private key file) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; publishing stops without them. Only the release's `sign` job is given them, on a fresh machine where no dependency has run; builds themselves, and every branch build, use a throwaway key. They can be repository secrets, or, for extra protection, secrets of the `release` environment that job declares (Settings → Environments → release: add the two secrets there, and under Deployment branches and tags allow only `main` and `v*` tags; then delete the repository secrets of the same names). The public key is in `apps/desktop/src-tauri/tauri.conf.json`. A new key pair (`npx @tauri-apps/cli signer generate -w logbook-updater.key`) only helps future installs: copies already out there accept only the old key. Local builds (`npm run desktop:build`) don't make update files; add `--config src-tauri/tauri.release.conf.json` with the key in the environment to try.

The installers aren't code-signed (D77): Windows SmartScreen and macOS Gatekeeper warn on first open, and the README explains how to get past them. macOS builds are signed ad hoc (`signingIdentity: "-"`), without which Apple silicon Macs may report the app as damaged.

### The Android app (D90)

The Android app is the same Tauri shell built for phones: `apps/desktop/src-tauri/tauri.android.conf.json` gives it its own identifier (`app.logbookjournal.android`) and the Android web bundle (`vite build --mode android`, `npm run build:android -w @logbook/web`). Its Android project, `apps/desktop/src-tauri/gen/android`, is ours and committed: `MainActivity.kt` (room for the system bars and the keyboard) and `LogbookPlugin.kt` (printing, and writing files Android's save dialog picked) are hand-written; the rest came from `npx tauri android init`. The journal is a folder inside the app's own storage; there's no folder to choose and no updater (Settings → Updates checks GitHub for a newer APK and opens its download). Android's webview can only send text to the app, so file contents cross as base64, in 4 MB pieces (`packages/storage-fs/src/tauri.ts`).

To build it yourself you need Android Studio (or the Android SDK with the NDK), JDK 21, and the Rust targets (`rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android`), with `ANDROID_HOME` and `NDK_HOME` set:

```bash
cd apps/desktop
npx tauri android build --apk --target aarch64    # an unsigned APK under src-tauri/gen/android/app/build/outputs/apk/
npx tauri android dev                              # on a connected phone or an emulator, with hot reload
```

The release workflow's `android` job builds it for 64-bit and 32-bit ARM phones and x86-64 (emulators, Chromebooks). On a work branch it's **Logbook Preview** (`VITE_ANDROID_PREVIEW=1`): a separate app (`app.logbookjournal.android.preview`) with a journal of its own, signed with a throwaway key, which installs beside Logbook instead of over it, never looks for updates, and lets its page be inspected over USB. The `android-test` job installs it in an emulator and runs `apps/desktop/e2e/android.ts`: Playwright attaches to the app's page over adb, writes an entry, leaves the app and restarts it, saves a backup through Android's file picker and opens the PDF export's print screen. Its screenshots and logcat are in the `android-e2e` artifact. To install a preview on a phone, download the `android-preview` artifact, unzip it, open the APK and allow your browser or file manager to install apps.

**The Android signing key.** Android installs an update only if it's signed with the same key as the app already on the phone, so every release is signed with one key, forever. Losing it means people can't update without uninstalling Logbook, which deletes their journal. The release's `sign` job signs the APK with `apps/desktop/scripts/sign-android.sh`, using the secrets `ANDROID_KEYSTORE_BASE64` (the keystore file, base64-encoded), `ANDROID_KEYSTORE_PASSWORD` and optionally `ANDROID_KEY_ALIAS` (default `logbook`); without them the release has no APK and the workflow warns. To make the key, with a JDK installed (`keytool` comes with it):

```bash
keytool -genkeypair -keystore logbook-android.p12 -storetype PKCS12 -alias logbook -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Logbook"
```

It asks for a password. Then add the secrets to the `release` environment (Settings → Environments → release → Add environment secret): `ANDROID_KEYSTORE_PASSWORD` with that password, and `ANDROID_KEYSTORE_BASE64` with the file's contents in base64 (`base64 -w0 logbook-android.p12` on Linux, `base64 -i logbook-android.p12` on macOS, `[Convert]::ToBase64String([IO.File]::ReadAllBytes("logbook-android.p12"))` in PowerShell). Keep the `.p12` file and its password somewhere safe outside the computer, such as a password manager; never commit them.
