# Verified facts and open assumptions

Rule: no Stripe or Lulu integration code is written against anything not listed under **Verified** below. Each fact names its source and the date I read it. Snapshots of the Lulu sources are in [reference/](reference/).

## Verified (2026-10-07)

### Lulu Print API

Sources:
- **[L1]** OpenAPI spec `https://api.lulu.com/api-docs/openapi-specs/openapi_public.yml` (the source behind https://api.lulu.com/docs/). Snapshot: `reference/lulu-openapi-2026-10-07.yml`
- **[L2]** Product spec sheet `https://assets.lulu.com/media/specs/lulu-print-api-spec-sheet.xlsx`. Snapshot: `reference/lulu-print-api-spec-sheet-2026-10-07.xlsx`
- **[L3]** Book Creation Guide `https://assets.lulu.com/media/guides/en/lulu-book-creation-guide.pdf`. Snapshot: `reference/lulu-book-creation-guide-2026-10-07.pdf`

| Fact | Source |
|---|---|
| Production base URL `https://api.lulu.com`; sandbox `https://api.sandbox.lulu.com`; the sandbox needs a separate account at developers.sandbox.lulu.com | L1 `servers`, intro |
| Auth: OAuth2 client credentials. `POST …/auth/realms/glasstree/protocol/openid-connect/token`, `grant_type=client_credentials`, Basic auth with key:secret. Response has `access_token` and `expires_in`. Requests use `Authorization: Bearer` | L1 intro, `securitySchemes` |
| **Package IDs move to the dotted format** `[Trim].[Ink].[Quality].[Binding].[Paper].[Finish]`. Live from 2026-03-31; **legacy 27-char format unsupported from 2027-02-01** | L1 intro "POD Package Migration Notice" |
| Endpoints we use: `POST /print-job-cost-calculations/`, `POST /print-jobs/`, `GET /print-jobs/{id}/`, `GET /print-jobs/{id}/status/`, `POST /shipping-options/`, `POST /cover-dimensions/`, `POST /validate-interior/` + `GET /validate-interior/{id}/`, `POST /validate-cover/` + `GET /validate-cover/{id}/`, `POST/GET /webhooks/`, `PATCH /webhooks/{id}/`, `POST /webhooks/{id}/test-submission/{topic}/` | L1 `paths` |
| Cost calculation needs `line_items[{page_count, pod_package_id, quantity}]`, `shipping_address{street1, city, country_code, postcode, phone_number}` (+ `state_code` for US, MX, CA, AU, …) and `shipping_option`. The response includes `line_item_costs`, `shipping_cost`, `fulfillment_cost`, `fees[]` (e.g. `HANDLING_FEE`, `FULFILLMENT_FEE`), `total_cost_incl_tax`, `currency` | L1 lines ~283–790 |
| Shipping levels: `MAIL`, `PRIORITY_MAIL`, `GROUND_HD`, `GROUND_BUS`, `GROUND`, `EXPEDITED`, `EXPRESS` | L1 cost-calc `shipping_option` enum |
| `/shipping-options/` needs only `shipping_address.country` (+ `state` for listed countries incl. AU, US, CA, JP, IT, ES), `line_items`, optional `currency` (USD default; AUD, CAD, EUR and GBP also available) | L1 ~6245 |
| Address limits: `street1`, `street2` and `city` ≤ 30 chars; `name` ≤ 35; `phone_number` matches `^\+?[\d\s\-.\/()]{8,20}$` and is **required** | L1 cost-calc schema |
| Print job needs `line_items` (each with `printable_normalization.cover.source_url`, `.interior.source_url`, `pod_package_id`, `quantity`, `title`), `shipping_address` (with phone), `contact_email`, `shipping_level`. Optional `external_id` and `production_delay` (60–2880 min) | L1 ~1913–2000, example ~1770 |
| File URLs must be downloadable by Lulu; basic auth in the URL is allowed | L1 ~1989 |
| A print job stays `UNPAID` until paid in the developer portal, **unless a card is on file** (then it's charged automatically) | L1 ~1995 |
| `recipient_tax_id` is required for BR, CL, MX | L1 ~1977 |
| Print job statuses: `CREATED`, `UNPAID`, `PAYMENT_IN_PROGRESS`, `PRODUCTION_DELAYED`, `PRODUCTION_READY`, `IN_PRODUCTION`, `SHIPPED`, `DELIVERED` (not all carriers), `REJECTED`, `CANCELED`. Tracking is in `line_item_statuses[].messages.tracking_id/tracking_urls/carrier_name` | L1 intro |
| Webhooks: topic `PRINT_JOB_STATUS_CHANGED`, payload `{topic, data}` where `data` = print job. Header `Lulu-HMAC-SHA256` = HMAC-SHA256 of the **raw body** keyed with the API secret. 5 retries, then auto-deactivated; re-enable via PATCH | L1 intro "Webhooks" |
| Interior validation statuses `VALIDATING → VALIDATED`, or `NORMALIZING → NORMALIZED` when `pod_package_id` is passed; `ERROR` with `errors[]`. Cover validation: `NORMALIZING → NORMALIZED` or `ERROR`; needs `source_url`, `pod_package_id`, `interior_page_count` | L1 intro + ~7891, ~8392 |
| `/cover-dimensions/` takes `pod_package_id`, `interior_page_count`, `unit` (`pt` default, `mm`, `inch`) and returns `width`, `height`, `unit`. Lulu's example (6×9, 210 p) returns 920 × 666 pt. That equals 2×6″ + 2×0.125″ bleed + spine (210/444 + 0.06″) by 9″ + 2×0.125″, so the dimensions **include bleed** (my arithmetic, consistent with L3's formula) | L1 ~8220, L3 p.13 |
| Page limits (curated set): paperback **32–800**, hardcover case wrap **24–800**. One sheet row (`0850X1100.FC.PRE.PB.080CW444.GXX`) says min 20; the guide says paperback min is 32 | L2, L3 p.13 |
| List prices (USD): 6×9 PB base $1.99; 6×9 CW base $10.68; 8.5×11 PB $2.16; 8.5×11 CW $10.98. Per page: BW STD 60# $0.025 (6×9) / $0.0385 (8.5×11); FC STD 80# $0.0505 / $0.0635; FC PRE 80# $0.1389 / $0.2148 | L2 "Full Spec Sheet" |
| Interior PDF: single pages, 300–600 PPI images, fonts embedded, transparency flattened, page size = trim + 0.125″ bleed each side (6×9 → 6.25×9.25″), ≥ 0.5″ safety margin, ≥ 0.2″ gutter margin, no crop marks, no password | L3 p.23 |
| Cover PDF: single-page wraparound spread (back, spine, front), 0.125″ bleed, ≥ 0.5″ safety margin, fonts embedded, transparency flattened | L3 p.24 |
| Gutter additions by page count: < 60 → 0; 61–150 → +0.125″; 151–400 → +0.5″; 400–600 → +0.625″; > 600 → +0.75″ (added to the inside margin only) | L3 p.9 |
| Paperback spine width ≈ pages/444 + 0.06″; hardcover uses a step table (e.g. 195–222 p → 0.75″). **We don't use these for production; we call `/cover-dimensions/`** | L3 p.13–14 |
| No spine text for books of 80 pages or fewer | L3 p.15 |
| RGB is accepted (sRGB recommended); either colour space works for most projects | L3 p.5 |

### Stripe

Sources:
- **[S1]** https://docs.stripe.com/api/checkout/sessions/create
- **[S2]** https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted
- **[S3]** https://docs.stripe.com/tax/supported-countries
- **[S4]** https://stripe.com/au/pricing
- **[S5]** https://docs.stripe.com/testing

| Fact | Source |
|---|---|
| Hosted Checkout = `ui_mode: hosted_page` (default). `mode: payment`; `line_items` (≤ 100 in payment mode); `shipping_address_collection.allowed_countries`; `phone_number_collection`; `shipping_options` (≤ 5); `automatic_tax`; `metadata`; `client_reference_id` (≤ 200 chars); `expires_at` 30 min–24 h (default 24 h); `custom_fields` (≤ 3); `consent_collection`; `custom_text` | S1 |
| Fulfil on `checkout.session.completed` **and** `checkout.session.async_payment_succeeded`; optionally handle `checkout.session.async_payment_failed`. Retrieve the session, check `payment_status != 'unpaid'`, make fulfilment idempotent and safe under concurrency, record fulfilment | S2 |
| Local webhook testing: `stripe listen --forward-to localhost:4242/webhook` prints a `whsec_…` secret. With a webhook endpoint registered, Checkout waits up to 10 s for the `checkout.session.completed` response before redirecting | S2 |
| Stripe Tax: **AU-based businesses are supported**; physical goods ("All PTCs") supported for customers in AU, NZ, US, CA, GB, EU states, NO, CH, JP, SG, AE, MX and others. Collects only where you're registered | S3 |
| AU pricing: domestic cards 1.65% + A$0.30; international cards 3.5% + A$0.30 (page notes lower pricing from 1 Apr 2027); **+2% currency conversion**; Stripe Tax Basic 0.5% per transaction (no-code) or A$0.75 per transaction (API) where registered; fees are **not returned on refunds**; disputes A$25 | S4 |
| Test cards: success `4242424242424242`; generic decline `4000000000000002`; insufficient funds `4000000000009995`; always requires 3DS and succeeds `4000002760003184`; 3DS then declined `4000008400001629` | S5 |

### Lulu sandbox, checked by calling it

Source **[LS]**: calls to `https://api.sandbox.lulu.com` on 2026-10-07, made by `npm run lulu:packages` (`apps/server/scripts/verify-lulu-packages.ts`), `npm run lulu:validate` and by hand while writing them. Production (`api.lulu.com`) isn't reachable from the build environment, so nothing here is checked against it.

| Fact | Source |
|---|---|
| The sandbox token URL is the production path on the sandbox host: `POST https://api.sandbox.lulu.com/auth/realms/glasstree/protocol/openid-connect/token` with Basic auth and `grant_type=client_credentials`. The token lasts `expires_in: 3600` s; no refresh token (`refresh_expires_in: 0`) | LS |
| `/cover-dimensions/` answers **HTTP 201** with numbers as **strings** (`{"width":"920.000","height":"666.000","unit":"pt"}`). Rounding depends on the unit: `pt` to whole points (920.374 → 920), `inch` to 0.001″, `mm` to 0.01 mm. So we ask in mm (D44) | LS |
| `/cover-dimensions/` validates loosely: paperbacks get an answer even at 10 pages; hardcovers below 24 pages get 400 `["Wrong pages number"]`; an unknown binding gets 400 `["Unknown binding type XX"]`; an unknown paper code gets an **HTML 500 page**. It can't tell whether a package exists | LS |
| A cost calculation is the reliable package check: an unknown ID gets 400 `{"line_items":{"0":{"pod_package_id":["Pod Package does not exist"]}}}`. **All 16 package IDs Logbook uses exist** | LS |
| Sandbox print costs equal the spec-sheet list prices exactly (base + pages × per-page), for all 16 packages at 100 pages, e.g. 6×9 premium-colour paperback $1.99 + 100 × $0.1389 = $15.88, 6×9 premium-colour hardcover $24.57, 8.5×11 premium-colour hardcover $32.46 | LS, L2 |
| A single copy to Portland, OR by `MAIL`: line item $15.88, `shipping_cost` $5.69, `fulfillment_cost` $0.75 (its own object; the response had no `fees[]` and no handling fee), tax $0, total $22.32 USD. Lulu normalises the address and says so in `shipping_address.warnings[]` (`"1 Main St -> 1 SE Main St"`, code `REPLACED`) | LS |
| Paperback covers: trim + 0.125″ bleed on each outer edge; spine = pages/444 + 0.06″, the guide's formula, for both 080CW444 and 060UW444 paper | LS, L3 p.13 |
| **Hardcover (case wrap) covers: trim + 0.875″ on each outer edge** (0.75″ wrap + 0.125″ bleed), with a stepped spine: 24–84 pages 0.25″, 86–140 0.5″, 142–168 0.625″, 170–194 0.688″, then about 1/16″ more per 28 pages, to 2.125″ at 800 (full table in `packages/core/src/print/cover.ts`). Lulu's help centre puts the hinge about 0.25″ from the spine on both boards. Answers open question #7 (D46) | LS; [Lulu help: hardcover casewrap cover](https://help.lulu.com/en/support/solutions/articles/64000308572-creating-your-hardcover-casewrap-cover) (read via search summary; the page itself is blocked from the build environment) |
| Validation jobs answer 201 with `status: null` and are then polled. Interiors sent with a package ID go `NORMALIZING → NORMALIZED` and report `page_count` and `valid_pod_package_ids` (e.g. 872 IDs for a 6×9 48-page file). **Covers go `null → VALIDATING → NORMALIZED`**: the spec lists `NORMALIZING` for covers, not `VALIDATING`, so the client treats any "…ING" state as running | LS |
| A file Lulu can't fetch ends in `ERROR` with `"Failed to fetch from the source URL '…', received a 404 status code."`. Lulu follows GitHub's 302 redirect from a release download to `release-assets.githubusercontent.com` (D43) | LS |
| Timing: covers finish within a few seconds. On first submission the 200-page 8.5×11 interior was still normalizing after about 90 s. Resubmitting the same ten URLs a few minutes later finished in 7 s, so Lulu seems to reuse results for a file it has seen | LS |

### Sample books validated by Lulu

`npm run lulu:validate` (M2 slice D) rewrites the block below.

<!-- lulu-validation:start (written by scripts/validate-samples.ts) -->
**2026-10-07, Lulu sandbox: every sample file passed.** Files rendered by Chromium 153.0.8010.12 at commit `8dd6b6d` and fetched by Lulu from `https://github.com/mikehuntskankhunt422-dev/Logbook/releases/download/lulu-samples-5/`. Took 7 s in total.

| Sample | Package ID | Pages | Interior (`/validate-interior/` with package ID) | Lulu page count | Cover (`/validate-cover/`) |
|---|---|---|---|---|---|
| 200-page--6x9-pb-matte | `0600X0900.FC.PRE.PB.080CW444.MXX` | 210 | NORMALIZED (job 1016540) | 210 | NORMALIZED (job 1016548) |
| 200-page--8.5x11-cw-gloss | `0850X1100.FC.PRE.CW.080CW444.GXX` | 192 | NORMALIZED (job 1016545) | 192 | NORMALIZED (job 1016541) |
| 40-page--6x9-bw-pb-matte | `0600X0900.BW.STD.PB.060UW444.MXX` | 48 | NORMALIZED (job 1016543) | 48 | NORMALIZED (job 1016544) |
| 40-page--6x9-pb-matte | `0600X0900.FC.PRE.PB.080CW444.MXX` | 48 | NORMALIZED (job 1016547) | 48 | NORMALIZED (job 1016549) |
| 40-page--8.5x11-cw-gloss | `0850X1100.FC.PRE.CW.080CW444.GXX` | 44 | NORMALIZED (job 1016546) | 44 | NORMALIZED (job 1016542) |
<!-- lulu-validation:end -->

### Stripe test mode, checked by calling it (2026-10-08)

With the test keys in this environment and `npm run stripe:check -w @logbook/server` (M3 §3 E).

| Fact | How it was checked |
|---|---|
| The test account is Australian (`country: AU`, default currency AUD); Checkout charges USD on it without any setup | `GET /v1/account`; sessions created in USD |
| Tax codes `txcd_35010000` ("Books") and `txcd_92010001` ("Shipping") exist | `GET /v1/tax_codes/…` |
| `stripe@22.6.2` pins API version `2026-08-26.dahlia`; in it the shipping address is at `collected_information.shipping_details`, not the older top-level `shipping_details` | SDK source; a real paid session's event, parsed by `paymentFromSession` |
| A session with **one allowed country**, two `shipping_rate_data` options with business-day estimates, `tax_behavior: exclusive`, a `success_url` with a `#/order/<id>` fragment and `expires_at` one hour ahead is accepted. The hosted page shows the country fixed, the book as "Printed book · 6 × 9 in premium colour paperback, matte, 200 pages", and "Australia Post Mail (11-12 business days)" | Created through `CheckoutService`, screenshot (open question #9, first half) |
| `4242 4242 4242 4242`: the page redirects to `success_url`; the session is `complete`/`paid`, total $59.99 (book $49.99 + Australia Post Mail $10.00); Stripe's real `checkout.session.completed` event moves the order to `paid` with the address, phone, email and the `MAIL` level; the same event again changes nothing | Headless Chromium on checkout.stripe.com; Events API |
| `4000 0000 0000 0002`: the page says "Your credit card was declined. Try paying with a debit card instead."; the session stays `open` and the order `awaiting_payment`. Expiring the session sends `checkout.session.expired`, which returns the order to `quoted` | Same |
| `4000 0027 6000 3184`: Stripe's "3D Secure 2 Test Page" opens in nested iframes from `testmode-acs.stripe.com` with Fail and Complete; after Complete the payment succeeds and the page redirects to `success_url`. A click before the page is ready can be lost, so the script retries | Same |
| With `customer_creation: 'always'` a paid session has a Stripe customer with the buyer's email, the PaymentIntent belongs to it and carries a `receipt_email`. Stripe emails a refund only when the charge belongs to a customer with a stored email and **Refunds** is on under Settings → Business → Customer emails; receipts and refund emails go out in live mode only (D76) | `stripe:check --card success`, then the session and PaymentIntent read back (2026-10-08); Stripe's [refunds](https://docs.stripe.com/refunds) and [receipts](https://docs.stripe.com/receipts) docs |
| Automated browser runs against **test-mode** hosted Checkout work (open question #10): no bot challenge blocked the payment | Same |
| The Stripe CLI (v1.51.1) gets a webhook signing secret with `stripe listen --print-secret` through `api.stripe.com`; forwarding events needs a websocket to `stripecli-ws-nw.stripe.com`. With both, Stripe's `checkout.session.completed` and `.expired` reach `POST /api/stripe/webhook`, pass signature verification and move the order | Proxy log; `stripe:check --listen` |
| Hosts hosted Checkout needs in a browser: `checkout.stripe.com`, `js.stripe.com`, `m.stripe.network`, `b.stripecdn.com`, `q.stripe.com`, `r.stripe.com`, `hooks.stripe.com`; the 3-D Secure test page is on `testmode-acs.stripe.com`. Not needed for paying: `merchant-ui-api.stripe.com`, `checkout-cookies.stripe.com`, `m.stripe.com`, `hcaptcha.com` (all refused here, payment still worked) | Proxy log during the runs |

### Lulu sandbox print jobs and webhooks, checked by calling it (2026-10-08)

Calls to `https://api.sandbox.lulu.com` from the build environment with the sandbox keys (M4 §1). Lulu's documentation hosts are blocked there, so the spec text was read from a 2025 copy of `openapi_public.yml` in a public GitHub mirror (`devlimelabs/lulu-print-mcp`), and every fact below was checked against the sandbox itself.

| Fact | How it was checked |
|---|---|
| `POST /print-jobs/` takes `pod_package_id` **inside** `line_items[].printable_normalization`; at the line-item level the sandbox answers 400 `{"line_items":{"0":{"printable_normalization":{"pod_package_id":["This field is required."]}}}}`. A job answers 201 with `status.name` `CREATED`, `production_delay` 60 (minutes, the default) and `is_cancellable: true` | Job 345111 |
| With no card on file, a job goes `CREATED → UNPAID` ("Print-job was accepted and needs to be paid") within about 7 s and stays there. **The sandbox account has no card on file** (open question #6). In a later run that evening jobs still stopped at `UNPAID` and stayed there for hours: no card is being charged | Jobs 345111–345113; a poller. Later: jobs 345136 (`UNPAID` from 16:11:47 to at least 19:31 UTC) and 345169 (17:43:42 to at least 19:31), `lulu:e2e --follow 90` (M4 §3) |
| **With a card on file, a new job pays itself**: `CREATED → PRODUCTION_DELAYED` ("Print-job is waiting for the production delay time to pass") within about 20 s, never `UNPAID`. A card added later does **not** pay jobs already `UNPAID` | Test card added to the sandbox account 2026-10-09 (the portal's payment form is Adyen's; Adyen's test Visa beginning 4111 was used). Jobs 345232 and 345259 paid themselves; 345136 and 345169 were still `UNPAID` after the card was added |
| After the 60-minute `production_delay` the sandbox plays out production and shipping by itself: `PRODUCTION_READY` about an hour after creation, `IN_PRODUCTION` about a minute later, **`SHIPPED`** ("All line-items were shipped") about three minutes after that, the line item `SHIPPED` with `tracking_id`, `carrier_name` "Australia Post" (the destination's carrier) and `tracking_urls` pointing at a sandbox placeholder (`https://api.sandbox.lulu.com/printer-wannabe-tracking/<id>`). `DELIVERED` didn't follow within about 20 minutes (open question #3) | Jobs 345232 (40-page) and 345259 (200-page), `lulu:e2e --follow 90` to Australia by `MAIL`, looked at every 20 s (M4 §3) |
| `estimated_shipping_dates` on a paid job: `dispatch_min/max`, `arrival_min/max` (e.g. dispatch 15–16 Oct, arrival 26–27 Oct for `MAIL` to Australia from 9 Oct). `costs.total_cost_incl_tax`: $19.54 for 48 pages, $44.29 for 210 pages, USD | Same jobs |
| When a job ships, Lulu emails the job's `contact_email` "Lulu Print API Order <order_id> Has Shipped". `<order_id>` is the print job's `order_id` (e.g. 326373), not its `id` | Your inbox: emails for jobs 345232 (order 326373) and 345259 (order 326402); `order_id` read from `GET /print-jobs/{id}/` |
| By the time a job is `UNPAID`, Lulu has downloaded both files (`source_file`), normalized them (`normalized_file`, `page_count`) and computed their MD5 (`source_md5sum`). Signed links valid for 10 minutes were enough (open question #8) | Jobs 345111 (GitHub release links) and 345112–345114 (Backblaze B2 signed links) |
| `source_md5sum` is checked: a wrong value makes the job `REJECTED` ("One or more line-items were rejected."), with `line_items[].status.messages.printable_normalization.interior[]` = "Given md5sum doesn't match actual md5sum (…) of file from '<url>'". `source_md5_sum` (the spec's spelling) is ignored | Jobs 345113 (ignored) and 345114 (rejected) |
| `GET /print-jobs/?search=<text>` finds jobs by `external_id` (and other fields) | Search for `logbook-m4-probe-1` |
| `PUT /print-jobs/{id}/status/ {"name":"CANCELED"}` cancels an `UNPAID` job: 200, "Print-job was canceled" | Jobs 345112, 345113 |
| `GET /print-jobs/{id}/costs/` for a 48-page 6 × 9 in premium-colour paperback by `MAIL` to Oregon: line item $8.66 (list price), shipping $5.69, fulfilment $0.75, tax $0, total $15.10 | Job 345111 |
| Webhooks: `POST /webhooks/ {topics, url}` → 201 `{id (UUID), is_active, topics, url}`; `POST /webhooks/{id}/test-submission/PRINT_JOB_STATUS_CHANGED/` → 200 "Test webhook submission queued", delivering a dummy print job (`id` 1); `GET /webhook-submissions/` lists deliveries with `payload` (`{topic, data}`), `is_success`, `response_code`, `attempts`, but **not the signature**; `DELETE /webhooks/{id}/` → 204 | A subscription to `https://example.com/…` (answered 405), then deleted |
| The spec documents a print-job status `ERROR` (after `IN_PRODUCTION`) and line-item statuses `CREATED`, `ACCEPTED`, `REJECTED`, `IN_PRODUCTION`, `ERROR`, `SHIPPED` | Spec copy; `ACCEPTED` and `REJECTED` seen in the sandbox |

### Resend, checked by calling it (2026-10-08)

With the Resend key, sender and alert address in this environment and `npm run email:check -w @logbook/server` (M4 §3).

| Fact | How it was checked |
|---|---|
| `POST https://api.resend.com/emails` with `Authorization: Bearer <key>`, JSON `{from, to[], subject, text, tags[]}` and an `Idempotency-Key` header is accepted and answers `{id}` (D73) | The `alert` email for a test order, sent by the real job runner and `ResendMailer` to `OWNER_EMAIL`: email `01a11c32-c337-7c0a-a263-c72f0797aa96` |
| The key in this environment can only send: `GET /emails/{id}` answers 401 `restricted_api_key` ("This API key is restricted to only send emails"), so whether an email was delivered can't be read back from here | Same run |
| `EMAIL_FROM` is Resend's shared test sender, `onboarding@resend.dev`. Resend sends from it only to the address the Resend account belongs to, so customer emails (`problem`, `shipped`, `refunded`) need a domain of yours verified in Resend and `EMAIL_FROM` on that domain. Until then the server doesn't send them (D76) | Resend's documented rule, not tested: testing it would mean emailing someone else. The alert to `OWNER_EMAIL` was accepted, which fits |
| An alert sent from `onboarding@resend.dev` to your Gmail **arrived in spam** | You found it there, 2026-10-09 (email `01a11c32-…`) |

### Desktop (Tauri 2), checked 2026-10-09 (M5)

`v2.tauri.app`, `learn.microsoft.com`, `azure.microsoft.com` and the certificate sellers don't resolve or are refused from the build environment, so I read the **sources those sites are built from**, plus the plugin crates themselves:

- **[T]** Tauri's documentation, from `tauri-apps/tauri-docs` (branch `v2`, `src/content/docs/…`), the repository `v2.tauri.app` is built from: `plugin/updater.mdx` [T-upd], `start/prerequisites.mdx` [T-pre], `distribute/Sign/{windows,macos,linux}.mdx` [T-win], [T-mac], [T-lin], `distribute/Pipelines/github.mdx` [T-gh], `distribute/{appimage,rpm,windows-installer,microsoft-store}.mdx` [T-app], [T-rpm], [T-wi], [T-ms].
- **[C]** The crates as published on crates.io: `tauri-plugin-updater` 2.12.0 [C-upd], `tauri-plugin-fs` 2.5.2 [C-fs], `tauri-plugin-dialog` 2.7.3 [C-dlg].
- **[MS]** Microsoft's documentation sources: `MicrosoftDocs/azure-docs` `articles/artifact-signing/{quickstart.md,faq.yml}` [MS-as], and `MicrosoftDocs/windows-dev-docs` `hub/apps/package-and-deploy/smartscreen-reputation.md` (dated 2026-05-04) [MS-ss].
- **[A]** Apple, fetched directly: `developer.apple.com/programs/enroll/` and `/help/account/membership/program-enrollment/` [A-enr].

**Versions** (npm registry and crates.io API, 2026-10-09). As with Stripe (D62) and pdf.js (D64), I pin the newest release that is at least two weeks old, i.e. published by 2026-09-25 (D77):

| Package (npm / crate) | Newest | Pinned | Published |
|---|---|---|---|
| `@tauri-apps/cli` | 2.12.1 (2026-09-30) | **2.11.5** | 2026-09-20 |
| `tauri` crate / `@tauri-apps/api` | 2.12.2 (today) / 2.12.2 | **2.11.6** / **2.11.1** | 2026-09-19 / 2026-06-17 |
| `tauri-build` | 2.7.1 (2026-09-30) | **2.6.3** | 2026-06-17 |
| `tauri-plugin-dialog`, `@tauri-apps/plugin-dialog` | 2.8.1 (2026-10-01) | **2.7.3** | 2026-08-31 |
| `tauri-plugin-fs`, `@tauri-apps/plugin-fs` | 2.6.0 (2026-09-26) | **2.5.2** | 2026-08-31 |
| `tauri-plugin-updater`, `@tauri-apps/plugin-updater` | 2.13.2 (2026-10-07) | **2.12.0** | 2026-09-20 |
| `tauri-plugin-process`, `@tauri-apps/plugin-process` | 2.4.0 (2026-09-26) | **2.3.1** | 2025-10-27 |

Tauri 3 exists only as alphas (`3.0.0-alpha.*` on the `next` tag); not used.

**Updater**

| Fact | Source |
|---|---|
| Update signatures can't be turned off. Keys come from `tauri signer generate`; the public key goes in `tauri.conf.json` (`plugins.updater.pubkey`, the key's content, never a path); the private key must never be shared, and **losing it means installed apps can never be updated again** | T-upd |
| At build time the private key comes from `TAURI_SIGNING_PRIVATE_KEY` (a path or the key's content) and its password from `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; `.env` files don't work | T-upd |
| With `bundle.createUpdaterArtifacts: true`: Linux signs the AppImage itself (`.AppImage` + `.AppImage.sig`); macOS adds `.app.tar.gz` + `.sig`; Windows signs the NSIS `-setup.exe` and the `.msi` (each + `.sig`). (`"v1Compatible"` makes zip/tar.gz wrappers instead) | T-upd |
| Static `latest.json`: `version` (SemVer, `v` prefix allowed), optional `notes` and `pub_date` (RFC 3339), and `platforms` keyed `OS-ARCH` (`linux`/`darwin`/`windows` × `x86_64`/`aarch64`/`i686`/`armv7`), each with `url` and `signature` = **the content of the `.sig` file** (not a URL). The whole file is validated before the version is compared, so every platform entry must be complete | T-upd |
| Not in the docs: the plugin first looks for **`{os}-{arch}-{installer}`** (`appimage`, `deb`, `rpm`, `app`, `msi`, `nsis`, from the bundle type compiled into the app), then `{os}-{arch}`. So one `latest.json` can send NSIS installs the `.exe` and MSI installs the `.msi` | C-upd `get_urls` |
| A downloaded update is verified (minisign) against the public key **before** it's installed. `.deb`/`.rpm` installs self-update through `pkexec dpkg -i` / `pkexec rpm -U` (a password prompt); AppImages replace themselves | C-upd `verify_signature`, `install_deb` |
| `requireSignedVersion` (plugin config) rejects an update whose signature doesn't carry the same version `latest.json` announces, so an old signed release can't be replayed as a new one. CLI 2.11.5's `signer sign` writes the version into the signature only with `--app-version` (checked with a throwaway key: without it the trusted comment is `timestamp:…	file:…`) | C-upd `verify_signed_version`; `tauri signer sign --help` |
| Endpoints must be HTTPS in production; the next endpoint is tried only on a non-2xx answer. GitHub works as a static host: `https://github.com/<owner>/<repo>/releases/latest/download/latest.json` | T-upd |
| Windows `installMode`: `passive` (default, progress bar, no clicks), `basicUi`, `quiet`. Relaunching after an update uses the process plugin | T-upd |

**File access**

| Fact | Source |
|---|---|
| The fs plugin allows a path if the plugin's **runtime scope** (`FsExt::fs_scope()`, which Rust code can extend with `allow_directory`) or the capability's scope allows it; denies win. So the app can grant exactly the folder the user picked, with no folder in the static configuration | C-fs `resolve_path` |
| On Unix, `requireLiteralLeadingDot` defaults to true: a recursive grant (`folder/**`) does **not** cover dot-folders such as `.logbook/` unless they're granted by name | C-fs `resolve_path` (`unwrap_or(cfg!(unix))`) |
| Watching is behind the crate feature `watch` (notify with the full debouncer) and the permissions `fs:allow-watch` / `fs:allow-unwatch` | C-fs `Cargo.toml`, `permissions/` |
| The dialog plugin adds a path chosen in its open or save dialog to the fs scope at runtime (directories recursively only when asked) | C-dlg `commands.rs` |

**Building**

| Fact | Source |
|---|---|
| Debian/Ubuntu build packages: `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`. Installed in this container, plus `patchelf` and `xdg-utils` (Tauri's own workflow example installs both) and `xvfb` for headless runs | T-pre, T-gh |
| AppImages must be built on the **oldest** system they should run on that has WebKitGTK 4.1; Ubuntu 22.04 is the suggested baseline (glibc) | T-app |
| `.msi` can only be built on Windows (WiX); NSIS can be cross-built. WebView2 install modes: `downloadBootstrapper` (default, 0 MB), `embedBootstrapper` (~1.8 MB), `offlineInstaller` (~127 MB), `fixedRuntime`, `skip` | T-wi |
| Tauri's GitHub example builds on `ubuntu-22.04`, `windows-latest` and `macos-latest` (both Apple targets); unsigned macOS builds should use an **ad-hoc identity (`signingIdentity: "-"`)** so Apple Silicon doesn't call a downloaded app "damaged" | T-gh, T-mac |

**Signing**

| Fact | Source |
|---|---|
| **Windows, unsigned:** SmartScreen shows "Windows protected your PC" and the user must choose "Run anyway"; reputation starts from zero for every version. **OV and EV certificates:** still an "unrecognised app" warning until the certificate or file builds reputation (weeks, hundreds of installs); EV no longer skips it. **Microsoft Store:** no warning | MS-ss |
| Tauri signs Windows builds with a certificate thumbprint (OV certificates bought before June 2023), Azure Key Vault, **Azure Artifact Signing** (`artifact-signing-cli` in `bundle.windows.signCommand`, with `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`), or any tool through `signCommand` with `%1` for the file. Newer OV/EV certificates: follow the issuer's tooling (keys live on hardware or a cloud HSM) | T-win |
| **Artifact Signing, open question #11:** "Public Trust certificates are available to organizations in the United States, Canada, the European Union, the United Kingdom, **Australia**, New Zealand, Japan, South Korea, Singapore, Switzerland, Norway, and Israel. **Individual developers must be located in the United States or Canada.**" Organisation validation asks for the legal business entity's name, a **website** belonging to it, a primary **email on a domain the entity owns**, a business identifier and address. A paid Azure subscription is required (no free or trial). Cost "approximately $10/month" | MS-as quickstart and FAQ; MS-ss |
| Tauri's Microsoft Store route lists a normal installer that must be offline (WebView2 `offlineInstaller`), update itself and be **code signed**, so the Store doesn't avoid buying a certificate | T-ms |
| **macOS:** Apple Developer Program, **US$99 a year** in local currency. An individual or sole trader enrols under their legal name; an organisation needs a legal entity and a D-U-N-S number. Outside the App Store: a **Developer ID Application** certificate (only the Account Holder can create one), and notarisation is required with it; a free account can't notarise | A-enr, T-mac |
| macOS CI variables: `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`; notarisation through an App Store Connect API key (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`) or an Apple ID (`APPLE_ID`, `APPLE_PASSWORD` = app-specific password, `APPLE_TEAM_ID`) | T-mac |
| **Linux:** nothing has to be signed to run. AppImages can carry a gpg signature (`SIGN=1`, `SIGN_KEY`, `APPIMAGETOOL_SIGN_PASSPHRASE`, `APPIMAGETOOL_FORCE_SIGN`), but AppImage never checks it itself. RPMs are signed with `TAURI_SIGNING_RPM_KEY` and `TAURI_SIGNING_RPM_KEY_PASSPHRASE`. The docs say nothing about signing `.deb` files | T-lin, T-rpm |

**Couldn't verify from here** (sites refused by the build environment's proxy): prices and current terms of OV code-signing certificates for an Australian individual (Certum, SSL.com); Artifact Signing's exact price; whether Microsoft accepts an Australian sole trader with an ABN but no company as an "organization"; the Microsoft Store's registration fee; and how OneDrive, Dropbox and iCloud name conflict copies (the desktop app doesn't rely on names, M5 §2.3).

## Not yet verified (blocking the code that depends on them)

1. ~~The sandbox token URL path.~~ **Answered 2026-10-07:** same path on the sandbox host (LS above).
2. `Lulu-HMAC-SHA256` encoding (hex or base64), and whether "API secret" means the client secret. Needs a real delivery to a public URL; until then both encodings are accepted (D69).
3. ~~Whether sandbox print jobs progress to `SHIPPED` or `DELIVERED`.~~ **Answered 2026-10-09:** with a card on file they reach `SHIPPED` with tracking about an hour after creation (above). Still open: `DELIVERED`, which didn't appear within about 20 minutes of shipping.
4. ~~Real sandbox cost-calculation output per package ID~~ (**answered 2026-10-07:** sandbox print costs equal list prices for all 16 IDs, LS above). Still open: `HANDLING_FEE` for other destinations and quantities (none appeared for one copy to the US), and whether production prices match the sandbox.
5. ~~The set of destination countries Lulu ships to.~~ **Answered 2026-10-08** from the sandbox's `/shipping-options/`: 206 of Stripe's 237 Checkout countries (D75). Still open: whether production's list is the same.
6. ~~Sandbox auto-payment with a test card on file.~~ **Answered 2026-10-08:** no card is on file in the sandbox account, so jobs stop at `UNPAID` (above). **Checked again that evening:** jobs 345136 and 345169 stayed `UNPAID` for 3 h 20 min and 1 h 48 min, so either no card is on file yet or the sandbox doesn't charge it (M4 §3, §6). **Answered 2026-10-09:** with a test card on file new jobs pay themselves and go straight to `PRODUCTION_DELAYED`; jobs already `UNPAID` stay unpaid (above).
7. ~~Case-wrap `/cover-dimensions/` output vs Lulu's template.~~ **Answered 2026-10-07:** the size includes the 0.75″ wrap and bleed; the hinge sits inside the board panels (LS above, D46).
8. ~~How long Lulu needs file URLs to stay valid after print-job creation.~~ **Answered 2026-10-08:** seconds; Lulu copies the files when it accepts the job (above, D71).
9. ~~Stripe hosted Checkout UX with a single allowed country~~ (**answered 2026-10-08:** the country shows fixed, Stripe test mode above). Still open: Stripe Tax Calculation API availability on your account.
10. ~~Whether Stripe permits automated browser tests against hosted Checkout.~~ **Answered 2026-10-08:** in test mode, yes, all three cards (Stripe test mode above).
11. ~~Azure Artifact Signing eligibility for an Australian individual.~~ **Answered 2026-10-09:** not eligible as an individual (individuals must be in the US or Canada); an Australian organisation is, with a website and an email on its own domain (Desktop above, M5 §6).
12. Which Lulu print sites serve which destinations (affects duties/VAT notices and AU GST treatment).
