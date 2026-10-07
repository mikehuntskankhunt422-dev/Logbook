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

### Sample books validated by Lulu

`npm run lulu:validate` (M2 slice D) rewrites the block below.

<!-- lulu-validation:start (written by scripts/validate-samples.ts) -->
Not run yet.
<!-- lulu-validation:end -->

## Not yet verified (blocking the code that depends on them)

1. The sandbox token URL path. I assume the same `/auth/realms/glasstree/…` path on `api.sandbox.lulu.com`; L1 lists only production.
2. `Lulu-HMAC-SHA256` encoding (hex or base64), and whether "API secret" means the client secret.
3. Whether sandbox print jobs progress to `SHIPPED` or `DELIVERED`.
4. Real sandbox cost-calculation output per package ID, single-copy `HANDLING_FEE` behaviour, and whether sandbox pricing matches production.
5. The set of destination countries Lulu ships to (will be built from `/shipping-options/`).
6. Sandbox auto-payment with a test card on file.
7. Case-wrap `/cover-dimensions/` output vs Lulu's template: do wrap and hinge areas fit inside the returned size?
8. How long Lulu needs file URLs to stay valid after print-job creation.
9. Stripe hosted Checkout UX with a single allowed country, and Stripe Tax Calculation API availability on your account.
10. Whether Stripe permits automated browser tests against hosted Checkout.
11. Azure Artifact Signing eligibility for an Australian individual.
12. Which Lulu print sites serve which destinations (affects duties/VAT notices and AU GST treatment).
