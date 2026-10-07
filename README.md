# Logbook

A local-first multimedia journal (website, installable PWA, and, later, a Tauri desktop app) that can be printed as a real book through Lulu.

> **Status:** milestone 1 (the journal) is done. Milestone 2 (book builder and print PDFs) is in progress: print layout and the PDF renderer work; see [docs/M2.md](docs/M2.md). Payments, fulfilment and desktop packaging come after; see [docs/PLAN.md](docs/PLAN.md). The full README (deployment, environment variables, Stripe CLI, signing, go-live checklist) arrives in milestone 6.

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

First-time Playwright setup: `npx playwright install chromium` in `apps/web`.

## Layout

| Path | What |
|---|---|
| `packages/core` | Data model, Journal service, encryption (Argon2id + AES-GCM), zip backup format, search, dates and streaks. No DOM. |
| `packages/storage-idb` | IndexedDB storage for the website and PWA |
| `apps/web` | React UI, PWA (manifest, service worker, icons), Playwright tests |
| `apps/server` | API (Fastify) and the print renderer: Paged.js in Chromium, image pipeline (sharp), PDF checks, sample books |
| `docs/` | Plan, decisions, verified API facts, dated reference snapshots |
