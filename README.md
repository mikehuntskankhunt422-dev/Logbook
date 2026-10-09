# Logbook

A local-first multimedia journal (website, installable PWA, and, later, a Tauri desktop app) that can be printed as a real book through Lulu.

> **Status:** milestones 1 (the journal), 2 (book builder and print PDFs) and 3 (pricing and Stripe) are done: the print layout and renderer, prices from Lulu's live costs, "Prepare my book", the order page and Stripe Checkout with webhooks all work in Stripe test mode. Milestone 4 (Lulu fulfilment) is under way: paid orders are sent to Lulu as print jobs, followed by webhooks and polling, retried, and refunded when they can't be printed; `npm run lulu:e2e -w @logbook/server` runs it against the Lulu sandbox and Stripe test mode. See [docs/M3.md](docs/M3.md) and [docs/M4.md](docs/M4.md). Emails, desktop packaging and the admin page come after; see [docs/PLAN.md](docs/PLAN.md). The full README (deployment, environment variables, Stripe CLI, signing, go-live checklist) arrives in milestone 6.

## Run it

Requires Node.js 24+.

```bash
npm install
npm run dev            # http://localhost:5173
```

Production build with the service worker (offline mode works here, not in `dev`):

```bash
npm run build
npm run preview        # http://localhost:4173
```

## Check it

```bash
npm run lint
npm run typecheck
npm test               # unit tests (Vitest): core, IndexedDB store, router
npm run test:e2e       # Playwright: desktop + mobile Chromium, incl. axe accessibility checks
npm run lhci           # Lighthouse CI against apps/web/dist (needs Chrome or Edge; set CHROME_PATH on Windows)
npm run test:print     # renders the sample books in Chromium and checks the PDFs the way Lulu's preflight does
npm run samples        # writes sample interior and cover PDFs to samples/out/ (e.g. `npm run samples -- 40-page`)
```

The print renderer uses Playwright's Chromium (`npx playwright install chromium` in `apps/server`). To use another Chromium build, set `LOGBOOK_CHROMIUM_PATH`.

### Lulu sandbox

Set `LULU_SANDBOX_CLIENT_KEY` and `LULU_SANDBOX_CLIENT_SECRET` (from developers.sandbox.lulu.com; never the live keys, which the server refuses in test mode). Then:

```bash
npm run lulu:packages                  # checks all 16 package IDs, cover sizes and costs; --record re-records the sizes CI uses
npm run samples                        # covers now use Lulu's live sizes
npm run lulu:validate -- <base URL>    # sends hosted sample PDFs to Lulu's validators, records the result in docs/ASSUMPTIONS.md
npm run pricing:table -w @logbook/server   # prices every product from live sandbox costs (docs/M3.md §2)
```

Lulu fetches files by URL. Until R2 exists, run the CI workflow by hand with **publish_samples** ticked: it publishes the sample PDFs as a GitHub pre-release and prints the base URL in the job summary (D43). `npm run dev -w @logbook/server` serves `GET /api/cover-dimensions` and `GET /api/quote`, which `npm run dev` proxies for the builder's exact cover size and price estimate.

### Ordering (M3)

`npm run dev -w @logbook/server` runs the API with orders stored in `apps/server/.data/` (development only, D51), and `npm run dev` proxies `/api` to it, so "Prepare my book…" in the builder works locally end to end. For real storage use any S3-compatible bucket: Backblaze B2 (free without a card) with `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, or Cloudflare R2 with `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Then `npm run storage:setup -w @logbook/server` sets the bucket's permissions (browser uploads, and reading proofs for the order page) and 7-day deletion, and checks them (docs/M3.md §3 C). `DATABASE_PATH` sets the orders database file (default `.data/logbook.sqlite`).

Payments use Stripe test mode: `STRIPE_TEST_SECRET_KEY` opens Checkout, `STRIPE_TEST_WEBHOOK_SECRET` verifies Stripe's webhooks at `POST /api/stripe/webhook` (for local runs, `stripe listen --forward-to localhost:4242/api/stripe/webhook` prints one), and `STRIPE_TAX_ENABLED=true` turns on automatic tax. Stripe only sends customers back to a website listed in `WEB_ORIGIN` (comma-separated origins), plus any loopback address in test mode, so list every website that takes payments there, including one served from the same host as the API. `npm run stripe:check -w @logbook/server` pays with the three Stripe test cards and checks each order ends in the right state (`-- --listen` has `stripe listen` deliver the webhooks). See [docs/M3.md](docs/M3.md).

### Fulfilment (M4, in progress)

Once Stripe says an order is paid, the server's job runner confirms the print files by hash, has Lulu validate them again, creates the Lulu print job and follows it (`POST /api/lulu/webhook`, plus polling every `LULU_TRACK_HOURS`, default 6). Failures are retried for about two hours, then the order needs attention; a book Lulu can't print is refunded in full. Lulu needs files it can download, so this works with a bucket, not local storage.

- `OWNER_EMAIL`: your address, Lulu's contact for print jobs and where alerts go (required in live mode).
- `RESEND_API_KEY` and `EMAIL_FROM`: emails to customers (problem, shipped with tracking, refunded) and alerts to you. Without them, emails are logged as not sent.
  `npm run email:check -w @logbook/server` sends a test alert to `OWNER_EMAIL`. With Resend's test sender (`onboarding@resend.dev`), which reaches only your own address, only alerts are sent; customers get Stripe's receipts and the order page instead (D76). Customer emails start once `EMAIL_FROM` is on a domain verified in Resend.
- `LOGBOOK_FAULTS` (test mode only): `files-missing`, `lulu-down` or `lulu-reject` make fulfilment fail on purpose.

```bash
npm run lulu:e2e -w @logbook/server                         # pay for the 40- and 200-page samples, follow the Lulu sandbox jobs
npm run lulu:e2e -w @logbook/server -- --fault lulu-reject  # Lulu rejects the job; the payment is refunded
npm run lulu:countries -w @logbook/server                   # which countries Lulu ships to (rewrites packages/core/src/print/lulu-countries.ts)
npm run lulu:webhook -w @logbook/server -- https://<api>    # subscribe the API to Lulu's webhooks (needs a public https address)
```

`npm run test:e2e` also runs the preview-parity check (the builder's page count for each sample equals the server's). Set `LOGBOOK_ALL_BROWSERS=1` to include Firefox and WebKit, after `npx playwright install firefox webkit` in `apps/web`. The e2e API always uses local storage and no Lulu, even when bucket variables are set. Set `LOGBOOK_E2E_ONLINE=1` (with the bucket and `LULU_SANDBOX_*` variables) to run "Prepare my book" against the real bucket and the Lulu sandbox instead (docs/M3.md §3 C).

First-time Playwright setup: `npx playwright install chromium` in `apps/web`.

### Desktop (M5, in progress)

The desktop app is Tauri 2 around the same web app ([docs/M5.md](docs/M5.md)). It needs Rust (stable) and, on Linux, the packages in Tauri's prerequisites (`libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`).

```bash
npm run dev -w @logbook/desktop      # the app with live reload (web dev server on :5174)
npm run build -w @logbook/desktop    # installers for this OS in apps/desktop/src-tauri/target/release/bundle/
```

## Layout

| Path | What |
|---|---|
| `packages/core` | Data model, Journal service, encryption (Argon2id + AES-GCM), zip backup format, search, dates and streaks. No DOM. |
| `packages/storage-idb` | IndexedDB storage for the website and PWA |
| `apps/web` | React UI, PWA (manifest, service worker, icons), Playwright tests |
| `apps/server` | API (Fastify) and the print renderer: Paged.js in Chromium, image pipeline (sharp), PDF checks, sample books |
| `docs/` | Plan, decisions, verified API facts, dated reference snapshots |
