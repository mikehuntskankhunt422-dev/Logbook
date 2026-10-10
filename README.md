# Logbook

A private journal for your computer: write about your days with photos, video, voice notes and links, and turn any stretch of it into a printed book.

Logbook is a free desktop app for Windows, macOS and Linux. Your journal is kept as ordinary files in a folder you choose, never on our servers. The only thing that costs money is a printed book, if you order one.

> **Status: preview (0.1.0).** Writing, photos and media, search, the calendar, backups, the passcode lock and the book builder with its page-by-page preview all work. **Not yet:** ordering a printed book (it opens once Logbook's print service is online), automatic updates (for now, download each new version yourself), and a screen for sorting out sync conflicts. Progress is tracked in [docs/PLAN.md](docs/PLAN.md) and [docs/M5.md](docs/M5.md).

## Download

Get the latest version from the [Releases page](https://github.com/mikehuntskankhunt422-dev/Logbook/releases).

| Computer | File | Notes |
|---|---|---|
| Windows 10 or 11 | `Logbook_<version>_x64-setup.exe` | Installs for your user account; no administrator needed |
| macOS 10.15 or later | `Logbook_<version>_universal.dmg` | Apple silicon and Intel |
| Linux | `.AppImage`, `.deb` or `.rpm` | The AppImage runs on most distributions; `.deb` for Ubuntu and Debian, `.rpm` for Fedora |

Each release lists the files' SHA-256 checksums in `SHA256SUMS.txt`.

### The first time you open it

Logbook isn't signed with a paid Apple or Microsoft certificate, so both systems warn about it once.

- **Windows:** if "Windows protected your PC" appears, click **More info**, then **Run anyway**.
- **macOS:** open the `.dmg` and drag Logbook to Applications. The first time you open it, macOS says it can't check it for malicious software.
  - macOS 15 (Sequoia) or later: click **Done**, open **System Settings → Privacy & Security**, scroll down to the message about Logbook, click **Open Anyway** and confirm.
  - Earlier versions: in Applications, Control-click (or right-click) Logbook, choose **Open**, then click **Open** in the message.
- **Linux:** make the AppImage executable (`chmod +x Logbook_*.AppImage`) and run it. The `.deb` and `.rpm` install like any other package.

## Using Logbook

**Your journal folder.** The first time Logbook opens, it asks where to keep your journal and suggests `Documents/Logbook`. Everything you write is saved there as you type:

```
Logbook/
  entries/2026/2026-10-10--a-good-day--k3f9x2m4n5p6.json    one file per entry, named by date and title
  media/k3/…                                               your photos, videos and recordings
  trash/                                                   deleted entries, kept for 30 days
  logbook.json                                             your settings
```

**Settings → Journal folder** shows the folder in Explorer or Finder. Put it inside OneDrive, Dropbox or iCloud Drive to keep a copy in the cloud and to use the same journal on another computer: there, choose that folder when Logbook asks. Use the journal on one computer at a time, and let the sync finish before you switch.

**Writing.** Each entry has a title, a mood, a cover and tags. Add text, photos (one, a grid or a collage), video, audio, files, links and YouTube or Vimeo videos, and drag them into any order, or move them with the keyboard. The calendar shows the days you wrote, "On this day" brings back past years, search finds any word, and the streak counts the days in a row.

**Backups.** The folder is your journal, so a copy of the folder is a backup. Logbook can also save one backup file: **Settings → Backups → Save a backup**, and it reminds you when it's been a while. **Restore from backup** brings one back, merged with what you have or replacing it. A backup unzipped into an empty folder also opens as a journal.

**Passcode lock.** **Settings → Passcode lock** encrypts every file in the folder, so entries can't be read without your passcode, and locks Logbook after a few idle minutes. A forgotten passcode can't be recovered.

**Printed books.** **Book** lets you pick a date range or individual entries, the size (6×9 or 8.5×11 inches), paperback or hardcover, and a matte or gloss cover, and shows every page as it will be printed. Ordering, with a proof to check, the price, delivery and payment through Stripe, opens in an update; books are printed and posted by [Lulu](https://www.lulu.com).

## Privacy

- Your journal stays on your computer, in your folder. Logbook has no account, no analytics and no tracking.
- Nothing is uploaded unless you order a book. Logbook first lists exactly what will be sent (the entries and photos in that book, nothing else) and asks you to confirm. Those files are used only to print your book and are deleted within 7 days.
- With a passcode on, the chosen entries are decrypted on your computer only to make the book.
- A YouTube or Vimeo video in an entry loads from that site when you play it.

## For developers

Logbook is a TypeScript monorepo (npm workspaces): a React app that runs in a [Tauri 2](https://tauri.app) window, and a Node server that makes print files and handles orders with Stripe and Lulu.

| Path | What |
|---|---|
| `packages/core` | Data model, journal service, encryption (Argon2id + AES-GCM), backup format, search, dates and streaks, the print layout |
| `packages/storage-fs` | The desktop journal: a folder of plain files in the backup layout |
| `packages/storage-idb` | Browser storage, for running the app in a browser during development and tests |
| `apps/web` | The app's screens (React). `--mode desktop` builds the bundle the desktop app loads |
| `apps/desktop` | The Tauri shell (Rust): the journal folder, save dialogs, links, installers, a WebDriver smoke test |
| `apps/server` | The API (Fastify): print PDFs (Paged.js in Chromium), pricing, Stripe Checkout, Lulu print jobs |
| `docs/` | Plan, decisions, milestone reports, verified API facts |

Quick start, with Node.js 24 and Rust (stable); on Linux also `libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`:

```bash
npm install
npm run desktop          # the app in a window, with hot reload
npm run dev              # the same screens in a browser, at http://localhost:5173
npm run lint && npm run typecheck && npm test
```

Building installers, making a release, running the server, Stripe and Lulu test modes, and the test suites are covered in [docs/DEVELOPING.md](docs/DEVELOPING.md). The reasons behind the design are in [docs/DECISIONS.md](docs/DECISIONS.md).
