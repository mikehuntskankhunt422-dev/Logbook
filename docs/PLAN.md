# Logbook: Plan

Status: **approved 2026-10-07**, with premium colour only (D24), the cost-based pricing table (D25), and all Lulu destinations (D26) · **Changed 2026-10-10: desktop only, no mobile app, no signing fees for now (D77, D78)** · Owner: you · Author: Claude

> **Desktop only (D77, D78, 2026-10-10).** Logbook is a **free desktop app** that has to be downloaded and installed, from GitHub Releases. There is no website and no mobile app. The web build still runs inside the desktop app and in development and tests, but it isn't hosted for the public. Customers pay only for printed books. Installers are unsigned for now, so Windows and macOS warn about an unknown developer the first time. The sections below that describe the website, the PWA or Cloudflare Pages are kept for reference; where they disagree with this note, this note wins.

This plan covers the architecture, the shared-core layout for web and desktop, milestones with acceptance criteria, risks, and the API facts still to verify. Companion documents:

- [DECISIONS.md](DECISIONS.md): every decision I made instead of asking, with the reasoning.
- [M2.md](M2.md): the detailed plan for milestone 2 (book builder and print PDFs), with spike results.
- [M3.md](M3.md): milestone 3 (pricing and Stripe): prices from sandbox costs, Checkout and webhooks in Stripe test mode.
- [M4.md](M4.md): milestone 4 (Lulu fulfilment): sandbox findings, the fulfilment design, end-to-end results, and what it still needs.
- [ASSUMPTIONS.md](ASSUMPTIONS.md): Stripe and Lulu facts I verified against official sources today, with links, and the ones I could not verify yet.
- [reference/](reference/): dated snapshots of Lulu's OpenAPI spec, product spec sheet and Book Creation Guide, so later work can be checked against the exact text I read.

---

## 0. Two things you should know first

1. **There is no prototype to start from.** `prototype/journal.html` does not exist on this PC. I searched every drive and you told me to build without it. So milestone 1 builds the journal from scratch, recreating the design language from your description: Bricolage Grotesque and Newsreader type, gradient entry covers, mood emojis, polaroid photos, a streak counter, springy motion, confetti, drag and drop, light and dark themes, and reduced-motion support. There's no legacy IndexedDB data to migrate. If the prototype turns up later, send it over and I'll reconcile the visual details.

2. **Your price anchors only work for one product.** Section 7 has the numbers from Lulu's current published costs:
   - **Hits the anchors:** a 6×9 premium full-colour paperback lands close to $30 / $50 / $70.
   - **Loses money:** the same anchors for 8.5×11 premium colour, which costs Lulu about $46 to print at 200 pages, against your $50 price.
   - **Overcharges:** for standard colour and black-and-white, the anchors are a 3–4× markup.

   I propose a cost-based table instead. It's provisional until we have real sandbox quotes.

---

## 1. Architecture at a glance

```
                    ┌──────────────────────── packages/core (TypeScript, no DOM) ───────────────────────┐
                    │ data model + zod schemas · StorageAdapter interface · backup zip format            │
                    │ crypto (Argon2id + AES-GCM) · search index · book selection · pagination planner   │
                    │ print layout (HTML + print CSS) · cover geometry · package-ID types · pricing types │
                    └───────────────▲──────────────────────────────▲─────────────────────▲───────────────┘
                                    │                              │                     │
          packages/ui (React)       │                              │                     │
          editor, views, builder ───┤                              │                     │
          flip-through preview      │                              │                     │
                ▲          ▲        │                              │                     │
   ┌────────────┴──┐  ┌────┴────────┴─────┐                ┌───────┴─────────────────────┴────────────┐
   │ apps/web      │  │ apps/desktop      │   HTTPS only   │ apps/server (Node 24 + Fastify)          │
   │ Vite PWA      │  │ Tauri 2 shell     │ ─────────────► │ quotes · orders · Stripe · Lulu          │
   │ IndexedDB     │  │ filesystem adapter│  (no secrets   │ Playwright/Chromium PDF render           │
   │ adapter       │  │ (Rust fs plugin)  │   in clients)  │ SQLite (orders only) · R2 (temp files)   │
   └───────────────┘  └───────────────────┘                │ Resend email · admin page                │
     Cloudflare Pages   GitHub Releases + updater          └──────────────────────────────────────────┘
                                                                     Fly.io (Docker), one machine + volume
```

**Monorepo** with npm workspaces, which ships with Node so you install no extra tooling:

| Path | What lives there |
|---|---|
| `packages/core` | Pure TypeScript with no DOM or Node APIs, so it runs in the browser, the Tauri WebView and Node. Contains the domain model, adapters (interface only), backup format, crypto, search, book planning, print HTML/CSS generation and shared types. |
| `apps/web/src` (UI) | React 19 components: editor (TipTap/ProseMirror), timeline, calendar heat map, on-this-day, search, settings, book builder, preview. Doesn't know which storage it is using. Kept in the web app per D27; desktop loads the same build. |
| `packages/storage-idb` | IndexedDB `StorageAdapter` for the website and PWA. |
| `packages/storage-fs` | Filesystem `StorageAdapter` for desktop, calling the Tauri fs and dialog plugins. |
| `apps/web` | Vite + `vite-plugin-pwa` (Workbox). Contains the manifest, service worker, icons, offline shell and the persistent-storage request. |
| `apps/desktop` | Tauri 2: loads the same `apps/web` build with `PLATFORM=desktop`, which selects `storage-fs`. Also holds the updater config and the installers. |
| `apps/server` | Fastify API, order state machine, job runner, Stripe, Lulu, PDF renderer, R2, email, admin. |
| `samples/` | Generated 40-page and 200-page sample journals plus their interior and cover PDFs. |
| `scripts/` | `verify-lulu-packages`, `refresh-lulu-countries`, `quote-anchors`, `make-samples`. |

### 1.1 Storage adapter (shared contract)

```ts
interface StorageAdapter {
  kind: 'indexeddb' | 'filesystem';
  open(): Promise<JournalMeta>;
  listEntries(q?: { from?: string; to?: string }): Promise<EntrySummary[]>;
  getEntry(id: string): Promise<Entry | null>;
  putEntry(e: Entry): Promise<void>;                  // optimistic concurrency via e.rev
  deleteEntry(id: string): Promise<void>;             // moves to trash; purge is separate and explicit
  putMedia(m: MediaMeta, data: Blob): Promise<void>;
  getMedia(id: string): Promise<Blob | null>;
  getMediaUrl(id: string): Promise<string>;           // object URL (web) / asset URL (desktop)
  deleteMedia(id: string): Promise<void>;
  getSettings(): Promise<Settings>; putSettings(s: Settings): Promise<void>;
  watch?(cb: (change: ExternalChange) => void): () => void; // desktop: files changed by OneDrive/Dropbox
}
```

The encryption layer is a **decorator** around any adapter: `EncryptedAdapter(inner, key)`. Both platforms therefore get identical encryption. The backup zip uses exactly the desktop folder layout, which makes "web journal → desktop app" a plain unzip with validation.

### 1.2 On-disk layout (desktop) and backup zip layout (both)

```
Logbook/                         ← folder the user picks (can sit inside OneDrive/Dropbox)
  logbook.json                   ← format version, journal settings, tag list
  entries/2026/2026-10-07--a-good-day--k3f9x2.json   ← one human-readable JSON file per entry
  media/k3/k3f9x2-01.jpg         ← originals, named by id, sharded by 2-char prefix
  media/k3/k3f9x2-01.poster.jpg  ← derived poster frames, thumbnails
  trash/                         ← soft-deleted entries (purged after 30 days, user-visible)
  .logbook/index.json            ← rebuildable cache (search, summaries); safe to delete
```

When a passcode is on, entry files become `*.json.enc` and media `*.enc`. The folder is then no longer human-browsable, and the app says so before you enable it. Sync conflicts like `entry (1).json` from OneDrive or `entry (conflicted copy).json` from Dropbox are detected and shown side by side for you to choose.

### 1.3 Data model (core)

- `Entry { id, date, title, mood?, cover: Gradient | {mediaId}, tags[], blocks[], createdAt, updatedAt, rev }`
- `Block` is a discriminated union:
  - `richtext`: ProseMirror JSON with bold, italic, H1–H3, bullet and ordered lists, links, plus autolink
  - `photo`
  - `gallery` (`grid` | `collage` layouts)
  - `video`, `audio`: poster frame, duration
  - `file`
  - `link`: URL, title, cached preview text
  - `embed`: `youtube` | `vimeo` with id

  Every media block has an optional `caption`.
- `MediaMeta { id, mime, bytes, width?, height?, durationMs?, posterId?, sha256 }`
- The schema is versioned and validated with zod on read. Migrations live in core and are unit-tested.

### 1.4 Print pipeline: one layout codebase, two renderers

`core/print` turns `(entries, BookOptions, ProductSpec)` into **one HTML document plus one print stylesheet**:

- The same stylesheet drives the in-app flip-through preview and the server PDF.
- Pagination uses **Paged.js** in both places: the user's browser for the live preview, and headless Chromium via Playwright on the server. The DOM is fragmented into identical page boxes, so the page count and breaks match.
- The **customer-facing proof is always the real server PDF**, shown with pdf.js before payment. That guarantees "what you approve is what's printed", even if the user's browser measures fonts slightly differently from server Chromium (Safari and Firefox can).
- Gutter depends on page count, and page count depends on the gutter. The planner iterates up to 3 times, and if it oscillates at a band edge it picks the larger gutter and pads.
- Page count is then forced **even** and **≥ the product minimum** by appending "Notes" pages, and rejected above the maximum (800) with a "split into volumes" suggestion.
- The cover is a single wraparound page sized from Lulu's `/cover-dimensions/` for the exact package ID and page count. Nothing is hardcoded; the guide's formulas are used only in unit tests as a sanity cross-check.
- Fonts (Bricolage Grotesque and Newsreader, both SIL OFL) are self-hosted and embedded by Chromium.
- Images are resampled server-side to 300–600 PPI at their placed size. Images below 300 PPI are warned about **by filename** in the builder.
- Print CSS avoids transparency (no `opacity`, `rgba`, shadows or blend modes) because Lulu requires flattened transparency.
- Non-printable content falls back as follows:

| Block | In print |
|---|---|
| video / audio | poster frame (audio gets a waveform card), duration, caption |
| link | title + short URL + QR code |
| YouTube / Vimeo embed | thumbnail if cached, title, QR code to the video |
| file | small tag: icon + filename + size |

### 1.5 Order flow (end to end)

1. **Builder (client).** You pick a date range or hand-pick entries, then trim, binding, interior and cover. You see a live preview, a page count, and a price **estimate** from `POST /api/quote`, which receives only the configuration and page count, never any content.
2. **"Prepare my book."** An explicit consent dialog lists exactly what will be uploaded (N entries, M photos, total size), where it goes, and when it is deleted. On confirm:
   - The server creates an order (`draft`) and returns presigned R2 **PUT** URLs.
   - The client uploads a bundle: entries JSON plus print-resolution media, downscaled client-side to cut upload size.
   - Content never passes through our API process or its logs.
3. **Server renders and validates.**
   - Renders interior and cover PDFs with Playwright and stores them in R2.
   - Calls `/cover-dimensions/` first.
   - Calls Lulu `/validate-interior/` and `/validate-cover/` with short-lived presigned **GET** URLs and polls until `VALIDATED` / `NORMALIZED` or `ERROR`.
   - Prices the order from **live** `/print-job-cost-calculations/` data. The order becomes `quoted`.
4. **Proof and price.**
   - You see the actual PDFs (pdf.js), the final page count, and the itemised book price.
   - You pick the destination country (and state where Lulu needs it). Shipping options and costs come from Lulu `/shipping-options/`.
   - Then the content notice, Terms acceptance, and the required **"I have checked my book"** checkbox.
5. **Checkout.**
   - The server builds a hosted Stripe Checkout Session from the stored quote, never from client numbers:
     - USD line items
     - `shipping_address_collection.allowed_countries` limited to **the destination chosen in step 4** (always one of the countries Lulu ships to)
     - up to 3 `shipping_options` priced from Lulu's quote plus a buffer
     - `phone_number_collection`
     - `automatic_tax` when enabled
     - `metadata.order_id` and `client_reference_id`
     - an idempotency key `checkout:<orderId>:<quoteVersion>`
   - Status becomes `awaiting_payment`.
   - The country restriction is needed because hosted Checkout can't recalculate shipping after it collects the address; that only works in embedded mode.
6. **Webhooks are the source of truth.**
   - Handled events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`.
   - Signatures are verified on the raw body. Event IDs are stored and processed once; fulfilment happens only when `payment_status` is `paid`. Status becomes `paid`.
7. **Fulfilment job** (DB-backed queue, retries with exponential backoff):
   - Confirm the files: the proof PDFs are reused if their checksums match, giving `files_generated`.
   - Re-validate with Lulu, giving `files_validated`.
   - Create the Lulu print job with `external_id = orderId`, the Stripe shipping address and phone, and the paid `shipping_level`, giving `submitted_to_lulu`.
8. **Tracking.**
   - Lulu `PRINT_JOB_STATUS_CHANGED` webhooks (HMAC-verified) are the primary signal, with polling of `/print-jobs/{id}/status/` as a fallback for orders not updated in 6 h.
   - Statuses move through `in_production`, `shipped` (tracking email) and `delivered`.
9. **Failure after payment.**
   - Retry with backoff, then `needs_attention`, an email to you, and an email to the customer.
   - If unrecoverable (for example Lulu `REJECTED` the file), an automatic full refund through Stripe gives `refunded`.
   - Retry and refund buttons are on the admin page.
10. **Cleanup.** The R2 lifecycle rule deletes `orders/*` after N days (default 7). A server sweep also deletes order files 14 days after `shipped`, or 3 days after `refunded` or `failed`.

### 1.6 Order state machine

```
draft → quoted → awaiting_payment → paid → files_generated → files_validated → submitted_to_lulu
      → in_production → shipped → delivered
Side states: failed (pre-payment, nothing charged) · needs_attention (post-payment, human required)
             · refunded (terminal)
```

- Transitions live in one table in `apps/server/src/orders/machine.ts`, and every transition writes an `order_events` row.
- Illegal transitions throw. Unit tests cover every legal and illegal edge.
- `needs_attention` can return to the step that failed (admin "retry") or go to `refunded`.
- Lulu `CANCELED` or `REJECTED` after submission maps to `needs_attention` with an automatic refund offer.

---

## 2. What differs between the three versions

| | Website | Installed PWA | Desktop (Tauri) |
|---|---|---|---|
| Where data lives | Browser IndexedDB for this site, this browser profile | Same IndexedDB as the website on that browser; installing doesn't copy data | Real files in a folder you choose |
| Eviction risk | Low after `navigator.storage.persist()` is granted, not zero. Clearing site data deletes everything | Same as website | None from the app; your files are yours |
| Backup | Zip export/import; on Chrome/Edge, "save to folder" via the File System Access API; download fallback elsewhere | Same | The folder *is* the backup; zip export too |
| Sync | None | None | Via OneDrive/Dropbox/iCloud folder, with conflict-copy detection |
| Offline | Full journal offline after first load; ordering needs a connection | Same, launches offline from its icon | Fully offline; ordering needs a connection |
| Passcode encryption | Yes | Yes | Yes (files become `.enc`) |
| Checkout | In-tab redirect to Stripe | Same | Opens Stripe in your default browser. The app polls order status; no deep-link protocol registered in v1 |
| Updates | On reload (SW update prompt) | Same | Signed auto-update from GitHub Releases |
| Large video | Limited by browser quota (warning shown) | Same | Limited only by disk |
| Secrets in bundle | None | None | None. The only key in the app is the public updater verification key |

---

## 3. Milestones and acceptance criteria

Each milestone ends with tests run and a report on what works, what's untested, and what I need from you.

**M1: Journal (website + PWA)**
- Core model, IndexedDB adapter, editor with rich text and drag-to-reorder blocks (dnd-kit, keyboard reorder too)
- Photo, gallery and collage blocks, video, audio, file, link, embed blocks, captions
- Tags, full-text search (MiniSearch), calendar with heat map, on-this-day
- Streaks, moods, gradient covers, confetti, themes, reduced motion
- Zip export/import with a backup reminder (after 14 days or 25 changes), File System Access "save to folder"
- Passcode lock (Argon2id → AES-GCM), large-media handling (poster frames, size warnings, optional compression)
- PWA manifest, service worker, icons, persistent storage
- Tests: Vitest unit tests (model, migrations, crypto, zip round trip, search); Playwright e2e (write an entry with photos, reload offline, export, wipe, import); axe accessibility checks; Lighthouse CI budgets.

**M2: Book builder and print PDFs** (detailed plan and scope changes in [M2.md](M2.md))
- Builder UI, Paged.js preview, the core print layout, fallbacks, QR codes, low-resolution warnings with filenames, gutter and padding logic
- Server `/render` with Playwright, using cover dimensions from Lulu
- Tests: pagination and gutter unit tests (min, max, even, band edges); golden-PDF tests (page count, page box sizes, embedded fonts checked with pdf-lib); `samples/` 40-page and 200-page PDFs generated and validated against Lulu sandbox `/validate-*`.

**M3: Pricing and Stripe**
- Pricing config in one file (`apps/server/src/pricing/config.ts`) with unit tests: min, max, hardcover, B&W, margin floor, never-below-cost
- Quote endpoint, Checkout Session creation, webhook handler with event-ID idempotency, live-mode guard
- Tests: webhook unit tests with Stripe-signed fixtures; integration tests in Stripe **test mode** via `stripe listen --forward-to`. Cards: success `4242 4242 4242 4242`, decline `4000 0000 0000 0002`, 3-D Secure `4000 0027 6000 3184`.

**M4: Lulu fulfilment**
- Lulu client (OAuth client-credentials, token cache), print-job creation, webhook subscription and HMAC verification, polling fallback
- R2 storage with signed links and lifecycle rule, emails (Resend), retries and backoff, `needs_attention`, auto-refund, fault injection (test mode only)
- `scripts/verify-lulu-packages` and `scripts/refresh-lulu-countries`
- Tests: state-machine unit tests; sandbox e2e that creates real print jobs for the 40-page and 200-page samples and follows them to the furthest status the sandbox reaches.

**M5: Desktop (the only product, D77, D78)**
- Tauri 2 shell, `storage-fs` adapter, folder picker, watcher, conflict UI, import from zip backup
- Windows MSI/NSIS first, then macOS (dmg) and Linux (AppImage, deb, rpm)
- Updater with a `latest.json` signed by our own updater key (free); GitHub Actions matrix that builds and attaches installers to each release
- Ordering from the desktop: Checkout opens in the default browser; Stripe's return goes to a small "Payment received, go back to Logbook" page served by the API, and the app polls the order (no website needed)
- Installers **unsigned** for now (no Apple or Windows signing fees). A first-run guide on the download page shows how to get past Windows SmartScreen and macOS Gatekeeper. Signing instructions for each OS are written down for when it's worth paying for

**M6: Polish, admin, docs**
- Admin page (password-protected): order list, status, errors, retry and refund
- Legal drafts (Privacy, Terms, Refund & Reprint, content notice), all marked **for lawyer review**
- README: setup, env vars, local run with the Stripe CLI, deploy, signing; `docs/PLATFORMS.md`; go-live checklist; final pass on accessibility and Lighthouse

**Done when (your definition, updated for D77):** in test mode, you can write a journal with photos in the desktop app, build a 200-page book, see an accurate preview and price, pay with a Stripe test card, and watch a Lulu sandbox print job get created and tracked. In addition: a refund works after a simulated failure, the desktop installer from GitHub Releases installs and updates itself, and the go-live checklist is complete.

---

## 4. Product configuration (curated) and package IDs

Taken from Lulu's spec sheet dated today, in the **new dotted format**. The legacy undotted IDs stop working on **1 Feb 2027**, so we use only the dotted ones. `scripts/verify-lulu-packages` will check every ID against the API before use.

| Option | Values | Package ID segments |
|---|---|---|
| Trim | 6×9 in · 8.5×11 in | `0600X0900` · `0850X1100` |
| Interior | B&W (60# white uncoated) · Premium colour (80# coated white), per D24 | `BW.STD.…060UW444` · `FC.PRE.…080CW444` |
| Binding | Paperback (perfect bound) · Hardcover (case wrap) | `PB` · `CW` |
| Cover finish | Matte · Gloss | `MXX` · `GXX` |

That gives 16 package IDs. Page limits from the sheet are **32–800 for paperback** and **24–800 for hardcover**. One sheet row (8.5×11 FC.PRE.PB.080CW444.GXX) says min 20; I use the guide's stricter 32.

---

## 5. Hosting and services

| Concern | Choice | Why (details in DECISIONS.md) |
|---|---|---|
| Website/PWA | ~~Cloudflare Pages~~ Not published (D77): the desktop app is the product. Cloudflare Pages remains the choice if a website comes back | Static, global, free tier, sits next to R2 |
| Desktop downloads | GitHub Releases, with the updater's `latest.json` | Free, and Actions already builds there |
| API + PDF rendering | Fly.io, Docker image based on Playwright's official image, 1 machine with 2 GB RAM and a volume | Chromium needs a real container; edge runtimes can't run it |
| Orders DB | SQLite (better-sqlite3) on the Fly volume, nightly backup to R2 | Orders only and low volume. Swapping to Postgres is a documented change |
| Temp files | Cloudflare R2 (S3 API), presigned URLs, lifecycle delete after 7 days | Lulu fetches by URL; no egress fees |
| Email | Resend | Simple API, good deliverability, free tier |
| CI/CD | GitHub Actions | lint, typecheck, unit tests, Playwright, axe, Lighthouse CI, Tauri release matrix |

---

## 6. Privacy commitments (enforced in code, not just policy)

- Content is uploaded only after an explicit per-order confirmation that lists what is sent, and only for the entries in that book.
- Uploads go straight to R2 via presigned PUT URLs (HTTPS), so the API process never sees content bytes.
- The API logs metadata only. A pino redaction list plus a unit test fails the build if a known content field name appears in a log call.
- Order files are deleted by lifecycle rule and by sweep (Section 1.5, step 10). Content is never used for anything else.
- The DB holds no journal text, only configuration, page count, prices, shipping address, email and statuses.
- Encrypted journals are decrypted on-device. Only the plaintext of the selected entries is uploaded for printing, and the consent dialog says so.

---

## 7. Pricing: your anchors vs. Lulu's real costs

Lulu publishes a base price and a per-page price for every package. For a full-colour softcover, here are your anchors set against those costs. Shipping is charged separately and isn't counted here.

Assumptions: $0.75 fulfilment fee (from Lulu's API example); Stripe worst case of 3.5% international card + 2% currency conversion + 0.5% Stripe Tax + about US$0.20; and a 4% refund/reprint reserve.

| Product (paperback) | 100 p @ $30 | 200 p @ $50 | 300 p @ $70 |
|---|---|---|---|
| 6×9 **premium** colour | 31.5% net | 27.1% | 25.2% |
| 6×9 standard colour | 61% | 62.5% | 63% |
| 8.5×11 **premium** colour | 5.6% | **−3.6% (loss)** | **−7.5% (loss)** |
| 8.5×11 standard colour | 56% | 57% | 57% |

Hardcover adds about $8.70 to Lulu's cost, so "+$12" holds roughly 25% margin on 6×9 and loses money on 8.5×11 premium.

**Proposal.**

```
price = max(minimum_price,
            friendly(lulu_cost × markup + handling),
            friendly(cost floor that guarantees ≥ 25% net margin))
```

Defaults: `markup = 1.35`, `handling = $8`, `minimum = $24.99`. `friendly` rounds up to $X.99. Using list prices, that gives the table below, with net margin in brackets:

| Size | Interior | Binding | min pages | 100 p | 200 p | 300 p |
|---|---|---|---|---|---|---|
| 6×9 | Premium colour | Paperback | $24.99 | **$30.99** (36%) | **$49.99** (29%) | **$68.99** (25%) |
| 6×9 | Premium colour | Hardcover | $27.99 | $42.99 (31%) | $60.99 (25%) | $82.99 (26%) |
| 6×9 | Standard colour | Paperback | $24.99 | $24.99 (58%) | $25.99 (40%) | $32.99 (35%) |
| 6×9 | B&W | Paperback | $24.99 | $24.99 | $24.99 | $24.99 |
| 8.5×11 | Premium colour | Paperback | $24.99 | $40.99 (30%) | $70.99 (25%) | $103.99 (25%) |
| 8.5×11 | Premium colour | Hardcover | $30.99 | $52.99 (27%) | $84.99 (25%) | $117.99 (25%) |
| 8.5×11 | Standard colour | Paperback | $24.99 | $24.99 (52%) | $29.99 (37%) | $37.99 (32%) |

The formula reproduces your anchors almost exactly for **6×9 premium colour**, which I'd make the default product. It charges honestly more for 8.5×11 premium, and much less for B&W and standard colour, which is fairer to customers than flat anchors. All numbers are **provisional**: M3 re-runs the table from real sandbox `/print-job-cost-calculations/` quotes, which add Lulu's fees and any tax Lulu charges us. Real costs could differ from list prices.

**Shipping** is charged at Lulu's quote grossed up for Stripe fees, plus a $1 buffer, rounded up to the next $0.50. The real cost is re-quoted after payment with the full address. If it overshoots the buffer, we absorb it and log it.

---

## 8. Tax: what Stripe Tax does and does not solve for you

Verified: an **Australia-based** Stripe account can use Stripe Tax for physical goods ("All PTCs") in AU, NZ, the US, Canada, the UK, the EU, Norway, Switzerland, Japan, Singapore and the UAE. However, **Stripe Tax only collects where you have added a registration.** Whether you must register is a question for an accountant, not code. Flags to raise with them, as a non-lawyer's checklist:

- **Australia:** GST registration is required at A$75k turnover. If Lulu prints Australian orders inside Australia (not verified yet), those sales may be GST-able local supplies.
- **United Kingdom:** overseas sellers of goods to UK consumers often must register for UK VAT **from the first sale** (no threshold), depending on where goods are dispatched from.
- **EU:** IOSS applies to imported consignments ≤ €150. Without it, customers may pay VAT plus a carrier fee on delivery, which conflicts with "nothing hidden afterwards".
- **US:** state economic-nexus thresholds apply. Lulu's quotes include tax Lulu charges *us*; a resale certificate may remove it.

**How the app handles it:** prices are tax-exclusive. `automatic_tax` is on whenever `STRIPE_TAX_ENABLED=true`, and tax appears as its own line on Stripe's page before payment. Our proof page shows "Tax: calculated from your address on the next page", plus an estimate from Stripe's Tax Calculation API where available. A **duties notice** appears for destinations where Lulu may ship cross-border; to verify which ones.

---

## 9. Risks (ranked) and mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | Lulu sandbox jobs may never progress to SHIPPED or DELIVERED | "Tracked to completion" can't be shown end-to-end | Verify early in M4. If stuck, use the webhook `test-submission` endpoint plus a test-only status simulator, and say so plainly. **Mostly cleared (M4 §3):** with a test card on the sandbox account, jobs reach `SHIPPED` with tracking; `DELIVERED` is covered only by unit tests |
| 2 | Chromium PDFs rejected by Lulu (transparency, fonts, sizes) | Orders blocked | Transparency-free print CSS, embedded fonts, validate every PDF with Lulu before charging, golden tests. Fallback: Ghostscript flattening pass in the renderer |
| 3 | Paged.js maintenance pace / fragmentation bugs | Bad page breaks | **Happened:** no stable release since 0.4.3 (July 2023). It still works in Chromium 141 (M2 spike), so it's pinned and owned (D34). Golden tests, own block-level packer as fallback. Customer always approves the real server PDF |
| 4 | Tax obligations (UK VAT, IOSS, GST) | Legal/financial | Accountant review before live. Option to launch in fewer countries first |
| 5 | Windows code-signing availability for an individual in Australia | Unsigned installer → SmartScreen warnings | Verify Azure Artifact Signing eligibility. Otherwise an OV certificate on a cloud HSM (Certum/SSL.com). Documented in M5 |
| 6 | Stripe may block automated browsing of hosted Checkout | Card tests can't be fully automated | Webhook logic tested with signed fixtures. Hosted-page card runs scripted with Playwright where allowed, otherwise a documented manual checklist |
| 7 | Address length limits (Lulu street1/city ≤ 30 chars, name ≤ 35) vs. Stripe addresses | Print job creation fails | Smart split into street1/street2. If it still doesn't fit, `needs_attention` plus an email asking the customer |
| 8 | Browser storage eviction for web users | Data loss | `persist()`, backup reminders, File System Access folder backups, a clear warning in the UI |
| 9 | Large media in IndexedDB (quota, Safari limits) | Import failures | Size warnings, optional compression, quota display, push heavy users to desktop |
| 10 | Brazil/Chile/Mexico need `recipient_tax_id` | Print job rejected | Collect via a Checkout `custom_field` only when the destination is BR/CL/MX, or exclude them at launch (default: exclude, revisit) |

---

## 10. API facts: verified vs. still to verify

All verified facts and their sources are in [ASSUMPTIONS.md](ASSUMPTIONS.md). Still **unverified**, to be checked in the sandbox and test mode before or while writing the code that depends on them:

1. ~~Lulu token URL for the **sandbox**.~~ Verified 2026-10-07: the production path works on the sandbox host.
2. Encoding of `Lulu-HMAC-SHA256` (hex or base64) and the exact signing key (the docs say "API secret"). To be tested with `/webhooks/{id}/test-submission/{topic}/`.
3. ~~Whether the sandbox advances print jobs to `SHIPPED`~~ (verified 2026-10-09: about an hour after creation, with a card on file, M4 §3). Still open: `DELIVERED`, which didn't appear within 20–25 minutes of shipping.
4. ~~Real sandbox costs for each mapped package ID~~ (verified 2026-10-07: equal to list prices for all 16). Still open: `HANDLING_FEE` vs `FULFILLMENT_FEE` behaviour beyond one copy to the US, and whether sandbox prices equal production prices.
5. ~~The full list of countries Lulu ships to.~~ Built 2026-10-08 by `npm run lulu:countries`: 206 of Stripe's 237 Checkout countries (D75).
6. ~~Whether print jobs auto-pay with a card on file in the **sandbox** account.~~ Verified 2026-10-09: new jobs pay themselves; jobs already `UNPAID` don't (M4 §3).
7. ~~`/cover-dimensions/` output for case-wrap hardcovers.~~ Verified 2026-10-07: it includes the 0.75″ wrap and bleed; the hinge sits inside the boards (D46).
8. ~~Maximum lifetime Lulu needs from file URLs after print-job creation.~~ Verified 2026-10-08: seconds; Lulu copies both files before the job is `UNPAID` (M4 §1).
9. Stripe Checkout behaviour when `allowed_countries` has a single entry (UX), and Stripe Tax Calculation API availability on your account.
10. Azure Artifact Signing eligibility for Australian individuals or sole traders.

---

## 11. What I need from you

**To approve now:**
- this plan
- the **colour interior** choice: premium only (my recommendation), or premium plus a cheaper "standard colour" option
- the **pricing proposal** in Section 7: my table, or keep your anchors and drop products that can't hit them
- launch countries: all Lulu destinations, or start narrower (AU, NZ, US, CA, UK, EU) while tax registrations are sorted

**Before M2 slice D (moved earlier, see [M2.md](M2.md) §2):** ~~the Lulu sandbox client key and secret~~ (received 2026-10-07) and a Cloudflare R2 bucket (still needed: the consent-and-upload step is built on a local storage backend and switches to R2 by configuration, M3 slice C).

**Before M3/M4 (test mode only, never live keys):**
- Stripe test secret and publishable keys, and permission for me to install the Stripe CLI on this PC
- A Lulu **sandbox** account (developers.sandbox.lulu.com) client key and secret, with a test card added for auto-pay
- A Cloudflare account (R2 bucket + Pages) and a Resend API key with a verified sending domain
- Your business name, contact email and domain, used in legal drafts, emails and Lulu `contact_email`

**Before M5:** ~~an Apple Developer account (for macOS signing), a decision on a Windows signing route~~ not needed for now: installers ship unsigned (D77). The GitHub repository for Actions and Releases exists.

**Also:** git has no name or email configured on this PC, so I haven't made any commits. Tell me the name and email to use for this repo's commits (set locally, not globally).
