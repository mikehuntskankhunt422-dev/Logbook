# Logbook

A private journal for your computer: write about your days with photos, video, voice notes and links, and turn any stretch of it into a printed book.

Logbook is a free app for Windows, macOS, Linux and Android phones. Your journal is kept as ordinary files on your own device, never on our servers. The only thing that costs money is a printed book, if you order one.

> **Status: preview (0.4.0).** Writing with rich formatting, photos and media, search, the calendar, backups, the passcode lock, the book builder with its page-by-page preview, export to Markdown, text, web page or PDF, a clock with alarms and timers, automatic updates and an Android app all work. **Not yet:** ordering a printed book (it opens once Logbook's print service is online) and a screen for sorting out sync conflicts. Progress is tracked in [docs/PLAN.md](docs/PLAN.md) and [docs/M5.md](docs/M5.md).

## Download

Get the latest version from the [Releases page](https://github.com/mikehuntskankhunt422-dev/Logbook/releases).

| Computer | File | Notes |
|---|---|---|
| Windows 10 or 11 | `Logbook_<version>_x64-setup.exe` | Installs for your user account; no administrator needed |
| macOS 10.15 or later | `Logbook_<version>_universal.dmg` | Apple silicon and Intel |
| Linux | `.AppImage`, `.deb` or `.rpm` | The AppImage runs on most distributions; `.deb` for Ubuntu and Debian, `.rpm` for Fedora |
| Android 7 or later | `Logbook-<version>.apk` | From 0.3.0; not on Google Play |

Each release lists the files' SHA-256 checksums in `SHA256SUMS.txt`.

### The first time you open it

Logbook isn't signed with a paid Apple or Microsoft certificate, so both systems warn about it once.

- **Windows:** if "Windows protected your PC" appears, click **More info**, then **Run anyway**.
- **macOS:** open the `.dmg` and drag Logbook to Applications. The first time you open it, macOS says it can't check it for malicious software.
  - macOS 15 (Sequoia) or later: click **Done**, open **System Settings → Privacy & Security**, scroll down to the message about Logbook, click **Open Anyway** and confirm.
  - Earlier versions: in Applications, Control-click (or right-click) Logbook, choose **Open**, then click **Open** in the message.
- **Linux:** make the AppImage executable (`chmod +x Logbook_*.AppImage`) and run it. The `.deb` and `.rpm` install like any other package.
- **Android:** open the release page on your phone and tap the `.apk`. When the download finishes, open it; Android asks you to allow your browser to install apps (**Settings → Install unknown apps**) the first time, then to confirm the install.

**On Android** your journal is kept inside the Logbook app on the phone, where other apps can't read it, and nothing is uploaded, not even to your Google backup. **Uninstalling Logbook deletes it**, so save backups (**Settings → Backups**: choose Google Drive or Downloads). To move your journal between your phone and a computer, save a backup on one and restore it on the other. New versions: **Settings → Updates** tells you when one is out and downloads it; installing it over the old one keeps your journal.

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

**Formatting.** The toolbar over the text has headings 1 to 6 (as many as you like), bold, italic, underline, strikethrough, colours and highlights, eight fonts (including Atkinson Hyperlegible and OpenDyslexic for easier reading), alignment, bulleted and numbered lists, checklists with tick boxes, tables, quotes, code, links, and country flags 🇯🇵 that show on every computer. **Settings → Appearance → Easier reading** sets the text size, the line spacing and the font you write in.

**Music and expiry.** **🎵 Music** gives an entry a sound file, or a link, that plays while it's open: a YouTube video or live stream (Lofi Girl, say), Vimeo, Rumble, Dailymotion, Twitch, Kick, Streamable, a sound file on the web or an internet radio station. Videos play in their site's own player, ads included; a link needs the internet. **⏳ Expiry** makes an entry expire in a day, a week, a month, a year or at a time you choose: then it moves to the trash by itself, where you can still restore it for 30 days.

**Backups.** The folder is your journal, so a copy of the folder is a backup. Logbook can also save one backup file: **Settings → Backups → Save a backup**, and it reminds you when it's been a while. **Restore from backup** brings one back, merged with what you have or replacing it. A backup unzipped into an empty folder also opens as a journal.

**Updates.** Logbook looks for a new version when it starts and twice a day, and asks before installing it: **Update and restart** saves your writing, installs the update and opens Logbook again. **Settings → Updates** checks at any time. Updates come from this repository's releases and install only if they carry Logbook's signature.

**Clock.** **⏰ Clock** has alarms (once or on chosen days), a timer and a stopwatch. They ring on any page with Logbook open, with Snooze and Stop; on Android they ring even when Logbook is closed, as notifications. They're kept on each device, not in the journal.

**Export.** **⬇️ Export** on an entry, on the journal page or on search results, or **Settings → Export**, turns your entries (all of them, a year, or a date range) into documents for other apps or for keeping: **Markdown** (one file, or a file per entry for notes apps such as Obsidian), **plain text**, a **web page**, or a **PDF** (Logbook opens your computer's print window: choose "Save as PDF" there). With photos included, you get a .zip holding the documents and a `media` folder. Exported files aren't protected by the passcode. To keep a copy you can restore into Logbook, make a backup instead.

**Passcode lock.** **Settings → Passcode lock** encrypts your entries, photos and other media in the folder, so they can't be read without your passcode, and locks Logbook after a few idle minutes. A forgotten passcode can't be recovered. Conflict copies (made by a sync service, or by Logbook when two computers changed the same entry) are kept as they were, unencrypted.

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
