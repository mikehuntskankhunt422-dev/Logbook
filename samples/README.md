# Sample books

Generated, not committed (the 200-page interior is about 20 MB). Recreate them with:

```bash
npm run samples          # needs Chromium: `npx playwright-core install chromium`, or set CHROMIUM_PATH
```

That writes two folders here, each with the upload bundle the web app would send (`bundle.zip`), the
print-ready `interior.pdf` and `cover.pdf`, and `report.json` (page plan, package ID, cover size,
print warnings, timings):

| Folder | Pages | Product |
|---|---|---|
| `sample-40/` | 40 | 6×9 premium-colour paperback, gradient cover |
| `sample-200/` | 200 | 6×9 premium-colour paperback, photo cover, 0.5″ gutter |

The journal is synthetic and deterministic (`apps/server/test/sample-journal.ts`): every block type,
portrait and landscape photos, both gallery layouts, a 600 × 400 scan that triggers the low-resolution
warning, and a PNG with transparency that has to come out flattened.

Covers here are sized with the guide's paperback formula (`source: "estimate"`), because Lulu
credentials aren't configured yet. Estimated covers are for review only and are never ordered. With
`LULU_CLIENT_KEY` and `LULU_CLIENT_SECRET` set, the server asks Lulu's `/cover-dimensions/` instead.
The CI `print` job regenerates both samples and attaches them to every run.
