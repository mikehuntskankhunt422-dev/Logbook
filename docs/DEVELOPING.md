# Developing Logbook

Everything needed to run, test, build and release Logbook. The user-facing overview is in the [README](../README.md); the reasons behind the design are in [DECISIONS.md](DECISIONS.md), and each milestone's report is in `docs/M*.md`.

## Setup

- **Node.js 24** or later, with npm.
- **Rust** (stable) for the desktop app. On Linux, Tauri's libraries too: `libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`. Windows needs the Microsoft C++ build tools; macOS needs Xcode's command-line tools.
- **Chromium for Playwright**, once: `npx playwright install chromium` in `apps/web` (tests) and in `apps/server` (the print renderer). To use another Chromium build, set `LOGBOOK_CHROMIUM_PATH`.

```bash
npm install
```

## Running it

```bash
npm run desktop                      # the desktop app in a window, with hot reload (Vite on port 5174)
npm run dev                          # the same screens in a browser, at http://localhost:5173
npm run dev -w @logbook/server       # the API on port 4242; both of the above proxy /api to it
```

The browser build (`npm run build`, then `npm run preview` at http://localhost:4173) isn't published (D78); it's how the Playwright tests run the screens, with the journal in IndexedDB instead of a folder. `vite build --mode desktop` (`npm run build:desktop -w @logbook/web`) is the bundle the desktop app loads: no service worker, the journal folder instead of IndexedDB, and the desktop-only code that the browser build leaves out.

The desktop app's first run asks where to keep the journal (`Documents/Logbook` by default). Its config file, which remembers the folder, is in the OS's app config folder under `app.logbookjournal.desktop`. Delete it to see the first run again.

## Checking it

```bash
npm run lint
npm run typecheck
npm test               # unit tests (Vitest): core, both storage packages, the server, the router
npm run test:e2e       # Playwright on the browser build: desktop and mobile Chromium, with axe accessibility checks
npm run test:print     # renders the sample books in Chromium and checks the PDFs the way Lulu's preflight does
npm run samples        # writes sample interior and cover PDFs to samples/out/ (e.g. `npm run samples -- 40-page`)
npm run lhci           # Lighthouse CI against apps/web/dist (needs Chrome or Edge; set CHROME_PATH on Windows)
```

The desktop app's own checks, in `apps/desktop`:

```bash
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cd ..
npx tauri build --debug --no-bundle    # the app, without installers
xvfb-run -a npm run test:e2e           # Linux: drives the app through WebDriver (M5 §1.2)
```

The smoke test needs `tauri-driver` (`cargo install tauri-driver --version =2.0.6 --locked`), WebKitWebDriver (`webkit2gtk-driver` on Ubuntu) and `python3-xlib`. It starts the app in a fresh home folder, chooses the default journal folder, writes an entry with a photo, checks the files on disk, restarts and checks again, then types an entry and closes the window at once, as the close button does, to check it was saved.

`npm run test:e2e` also runs the preview-parity check (the builder's page count for each sample equals the server's). Set `LOGBOOK_ALL_BROWSERS=1` to include Firefox and WebKit, after `npx playwright install firefox webkit` in `apps/web`. The e2e API always uses local storage and no Lulu, even when bucket variables are set. Set `LOGBOOK_E2E_ONLINE=1` (with the bucket and `LULU_SANDBOX_*` variables) to run "Prepare my book" against the real bucket and the Lulu sandbox instead (M3 §3 C).

CI (`.github/workflows/ci.yml`) runs all of this on pull requests and on `main`, including the desktop smoke test.

## Installers and releases

```bash
npm run desktop:build    # installers for this computer's OS, in apps/desktop/src-tauri/target/release/bundle/
```

`.github/workflows/desktop-release.yml` builds the installers on GitHub's runners: NSIS (`.exe`) on Windows, a universal `.dmg` on macOS, and AppImage, `.deb` and `.rpm` on Ubuntu 22.04 (an older Ubuntu, so the AppImage runs on more distributions). It runs on every push to a `claude/**` branch that touches the app, leaving the installers as workflow artifacts to try, and on every `v*` tag, when it also publishes them as a GitHub release with `SHA256SUMS.txt`.

To release a version:

1. Set the version in `apps/desktop/package.json` (`0.1.1`; numbers only, no `-beta` suffix). `tauri.conf.json` and the version written into backups both read it from there.
2. Write what changed in `apps/desktop/RELEASE-NOTES.md`; it becomes the release's description.
3. Tag the commit `v<version>` and push the tag. The workflow refuses a tag that doesn't match the version, and marks `0.x` versions as pre-releases.

The installers aren't code-signed (D77): Windows SmartScreen and macOS Gatekeeper warn on first open, and the README explains how to get past them. macOS builds are signed ad hoc (`signingIdentity: "-"`), without which Apple silicon Macs may report the app as damaged. A desktop build can order books only if it knows the API's address: set the repository variable `LOGBOOK_API_URL` (Settings → Secrets and variables → Actions → Variables) once the API is deployed. Without it, the book builder says ordering isn't open yet.

## The server

`npm run dev -w @logbook/server` runs the API. It's configured by environment variables, checked at startup; it refuses to start on a mistake rather than half-working. `APP_MODE` is `test` (the default) or `live`; live mode needs `ALLOW_LIVE=true` and live keys, and refuses test keys, and the other way round (D18).

| Variable | What |
|---|---|
| `HOST`, `PORT` | Where it listens (default `127.0.0.1:4242`) |
| `PUBLIC_URL` | The API's public address. Stripe sends desktop customers to its `/api/checkout/done` page after paying (D79). Required in live mode once Stripe is set, and https there |
| `WEB_ORIGIN` | Websites that may call the order API from a browser and that Stripe may return to (comma-separated). The desktop app's origins are always allowed |
| `DATABASE_PATH` | The orders database (SQLite, default `.data/logbook.sqlite`) |
| `LULU_SANDBOX_CLIENT_KEY`, `LULU_SANDBOX_CLIENT_SECRET` | Lulu's sandbox (test mode). Live mode uses `LULU_CLIENT_KEY`, `LULU_CLIENT_SECRET` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Order files in any S3-compatible bucket (Backblaze B2 is free without a card); or `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` for Cloudflare R2 |
| `LOCAL_STORAGE=on` | Test mode on this machine only: order files in a local folder instead of a bucket (D51) |
| `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET` | Stripe test mode (`STRIPE_LIVE_*` in live mode); `STRIPE_TAX_ENABLED=true` turns on automatic tax |
| `OWNER_EMAIL` | Your address: Lulu's contact for print jobs and where alerts go (required in live mode) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Emails through Resend: alerts to you, and customer emails once `EMAIL_FROM` is on a domain verified in Resend (D76) |
| `LULU_TRACK_HOURS` | How often to ask Lulu about each print job when no webhook arrives (default 6) |
| `LOGBOOK_FAULTS` | Test mode only: `files-missing`, `lulu-down` or `lulu-reject` make fulfilment fail on purpose |
| `LOGBOOK_CHROMIUM_PATH` | A Chromium for the print renderer other than Playwright's |

### Print files and the Lulu sandbox

With `LULU_SANDBOX_CLIENT_KEY` and `LULU_SANDBOX_CLIENT_SECRET` set (from developers.sandbox.lulu.com; never the live keys, which the server refuses in test mode):

```bash
npm run lulu:packages                        # checks all 16 package IDs, cover sizes and costs; --record re-records the sizes CI uses
npm run samples                              # covers now use Lulu's live sizes
npm run lulu:validate -- <base URL>          # sends hosted sample PDFs to Lulu's validators, records the result in docs/ASSUMPTIONS.md
npm run pricing:table -w @logbook/server     # prices every product from live sandbox costs (M3 §2)
npm run lulu:countries -w @logbook/server    # which countries Lulu ships to (rewrites packages/core/src/print/lulu-countries.ts)
```

Lulu fetches files by URL. Without a bucket, run the CI workflow by hand with **publish_samples** ticked: it publishes the sample PDFs as a GitHub pre-release and prints the base URL in the job summary (D43). The API's `GET /api/cover-dimensions` and `GET /api/quote` give the builder its exact cover size and price estimate.

### Ordering and payment

With the API running, "Prepare my book…" in the builder works end to end: orders are stored in `apps/server/.data/` with `LOCAL_STORAGE=on` (development only, D51), or in a bucket. `npm run storage:setup -w @logbook/server` sets a bucket's permissions (uploads from the desktop app and the dev servers, and reading proofs for the order page) and 7-day deletion, and checks them (M3 §3 C). Run it again on a bucket set up before the desktop app existed: its rules didn't include the app's origins.

Payments use Stripe test mode. `STRIPE_TEST_WEBHOOK_SECRET` verifies Stripe's webhooks at `POST /api/stripe/webhook`; for local runs, `stripe listen --forward-to localhost:4242/api/stripe/webhook` prints one. Stripe returns browser customers only to a website in `WEB_ORIGIN` (or any loopback address in test mode), and desktop customers to `/api/checkout/done` at `PUBLIC_URL`. The desktop app opens Stripe in the default browser and follows the order itself (D79).

```bash
npm run stripe:check -w @logbook/server      # pays with Stripe's three test cards and checks each order ends in the right state (-- --listen uses `stripe listen`)
```

### Fulfilment

Once Stripe says an order is paid, the server's job runner confirms the print files by hash, has Lulu validate them again, creates the Lulu print job and follows it (`POST /api/lulu/webhook`, plus polling). Failures are retried for about two hours, then the order needs attention and you get an alert; a book Lulu can't print is refunded in full. Lulu needs files it can download, so this works with a bucket, not local storage.

```bash
npm run lulu:e2e -w @logbook/server                          # pay for the 40- and 200-page samples, follow the Lulu sandbox jobs
npm run lulu:e2e -w @logbook/server -- --fault lulu-reject   # Lulu rejects the job; the payment is refunded
npm run lulu:webhook -w @logbook/server -- https://<api>     # subscribe the API to Lulu's webhooks (needs a public https address)
npm run email:check -w @logbook/server                       # sends a test alert to OWNER_EMAIL
```
