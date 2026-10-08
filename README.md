# Logbook

A local-first multimedia journal (website, installable PWA, and, later, a Tauri desktop app) that can be printed as a real book through Lulu.

> **Status:** milestones 1 (the journal) and 2 (book builder and print PDFs) are done: the print layout, the PDF renderer, the builder with its on-device preview, and Lulu sandbox validation of the sample books all work. Milestone 3 (pricing and Stripe) is nearly done: prices from Lulu's live costs, "Prepare my book" (consent, upload, server print files), the order page with a price per destination, and Stripe Checkout with webhooks all work in Stripe test mode (`npm run stripe:check -w @logbook/server`), with all three test cards (success, decline, 3-D Secure) and webhooks delivered by `stripe listen` (`-- --listen`). See [docs/M2.md](docs/M2.md) and [docs/M3.md](docs/M3.md). Sending paid orders to Lulu, emails and desktop packaging come after; see [docs/PLAN.md](docs/PLAN.md). The full README (deployment, environment variables, Stripe CLI, signing, go-live checklist) arrives in milestone 6.

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

### Ordering (M3, in progress)

`npm run dev -w @logbook/server` runs the API with orders stored in `apps/server/.data/` (development only, D51), and `npm run dev` proxies `/api` to it, so "Prepare my book…" in the builder works locally end to end. For real storage use any S3-compatible bucket: Backblaze B2 (free without a card) with `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, or Cloudflare R2 with `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Then `npm run storage:setup -w @logbook/server` sets the bucket's upload permissions and 7-day deletion and checks them (docs/M3.md §3 C). Set `WEB_ORIGIN` if the website is served from another host. `DATABASE_PATH` sets the orders database file (default `.data/logbook.sqlite`). Stripe keys (`STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`) are checked at startup but not used yet. See [docs/M3.md](docs/M3.md).

`npm run test:e2e` also runs the preview-parity check (the builder's page count for each sample equals the server's). Set `LOGBOOK_ALL_BROWSERS=1` to include Firefox and WebKit, after `npx playwright install firefox webkit` in `apps/web`. The e2e API always uses local storage and no Lulu, even when bucket variables are set. Set `LOGBOOK_E2E_ONLINE=1` (with the bucket and `LULU_SANDBOX_*` variables) to run "Prepare my book" against the real bucket and the Lulu sandbox instead (docs/M3.md §3 C).

First-time Playwright setup: `npx playwright install chromium` in `apps/web`.

## Layout

| Path | What |
|---|---|
| `packages/core` | Data model, Journal service, encryption (Argon2id + AES-GCM), zip backup format, search, dates and streaks. No DOM. |
| `packages/storage-idb` | IndexedDB storage for the website and PWA |
| `apps/web` | React UI, PWA (manifest, service worker, icons), Playwright tests |
| `apps/server` | API (Fastify) and the print renderer: Paged.js in Chromium, image pipeline (sharp), PDF checks, sample books |
| `docs/` | Plan, decisions, verified API facts, dated reference snapshots |
