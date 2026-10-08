# Logbook

A local-first multimedia journal (website, installable PWA, and, later, a Tauri desktop app) that can be printed as a real book through Lulu.

> **Status:** milestones 1 (the journal) and 2 (book builder and print PDFs) are done; validating the PDFs with Lulu's sandbox waits on sandbox credentials. Payments, fulfilment and desktop packaging come next; see [docs/PLAN.md](docs/PLAN.md). The full README (deployment, environment variables, Stripe CLI, signing, go-live checklist) arrives in milestone 6.

## Run it

Requires Node.js 24+.

```bash
npm install
npm run dev            # http://localhost:5173
```

The book builder's "Make print PDFs" button talks to the render server. Run it alongside (it uses Playwright's Chromium: `npx playwright-core install chromium` once, or set `CHROMIUM_PATH`):

```bash
npm run server         # http://localhost:8787 (POST /render, GET /health)
```

Without Lulu credentials (`LULU_CLIENT_KEY`, `LULU_CLIENT_SECRET`) paperback covers are sized with the guide's formula and marked as estimates; hardcover covers need the credentials. Other settings are listed at the top of `apps/server/src/main.ts`.

Production build with the service worker (offline mode works here, not in `dev`):

```bash
npm run build
npm run preview        # http://localhost:4173
```

## Check it

```bash
npm run lint
npm run typecheck
npm test               # unit tests (Vitest): core, IndexedDB store, router, server API
npm run test:render    # golden-PDF tests: real Chromium + Paged.js PDFs checked with pdf-lib
npm run samples        # writes 40- and 200-page sample books to samples/
npm run test:e2e       # Playwright: desktop + mobile Chromium, incl. axe accessibility checks
npm run lhci           # Lighthouse CI against apps/web/dist (needs Chrome or Edge; set CHROME_PATH on Windows)
```

First-time Playwright setup: `npx playwright install chromium` in `apps/web`.

## Layout

| Path | What |
|---|---|
| `packages/core` | Data model, Journal service, encryption (Argon2id + AES-GCM), zip backup format, search, dates and streaks. No DOM. |
| `packages/storage-idb` | IndexedDB storage for the website and PWA |
| `packages/core/src/print` | Print products and package IDs, page geometry, gutter/page-count planner, print HTML and CSS, cover layout, book bundle format |
| `apps/web` | React UI (journal and book builder with a Paged.js preview), PWA (manifest, service worker, icons), Playwright tests |
| `apps/server` | Render server: Fastify, network-isolated Chromium + Paged.js, sharp image prep, Lulu `/cover-dimensions/` client, golden-PDF tests |
| `samples/` | Generated sample books (not committed; see its README) |
| `docs/` | Plan, decisions, verified API facts, dated reference snapshots |
