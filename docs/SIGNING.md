# Signing Logbook's desktop app

How to sign the Windows, macOS and Linux builds, and the updates the app installs itself. Written for M5 ([M5.md](M5.md)); the facts behind it, with sources, are in [ASSUMPTIONS.md](ASSUMPTIONS.md) under "Desktop".

**Today** (2026-10-09):

- The updater key is set up (public key ID `F0A647A9FD7D370D`), so builds make signed update files.
- Windows installers are unsigned.
- The macOS app is ad-hoc signed and not notarised.
- Linux packages are unsigned.

The workflow (`.github/workflows/desktop.yml`) switches each one on by itself as soon as its secrets or variables exist; nothing else has to change. Its log says what it found ("Updater key: set", "macOS: no certificate…", "Windows: unsigned"). It never prints a secret's value, and GitHub masks them anyway.

**Never commit a private key, certificate or password.** They go only into GitHub → the repository → Settings → Secrets and variables → Actions. *Secrets* hold anything private; *variables* hold the public bits named below.

| What | Why | Needed | Costs | Secrets (S) and variables (V) |
|---|---|---|---|---|
| [Updater key](#1-the-updater-key-first) | The app installs only updates signed with it | **Now**, before the first release | Free | S `TAURI_SIGNING_PRIVATE_KEY`, S `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the public key in `tauri.conf.json` or V `TAURI_UPDATER_PUBKEY` |
| [macOS](#2-macos) | Without it, macOS won't open a downloaded app without a detour through System Settings | Before the first public release | US$99 a year (Apple Developer Program) | S `APPLE_CERTIFICATE`, S `APPLE_CERTIFICATE_PASSWORD`, S `APPLE_SIGNING_IDENTITY`, S `APPLE_API_ISSUER`, S `APPLE_API_KEY`, S `APPLE_API_KEY_P8` |
| [Windows](#3-windows) | Without it, SmartScreen says "Windows protected your PC" | Before the first public release | Depends on the route | V `WINDOWS_SIGN_COMMAND` and the route's own (for Azure: S `AZURE_CLIENT_ID`, S `AZURE_CLIENT_SECRET`, S `AZURE_TENANT_ID`) |
| [Linux](#4-linux) | Optional: lets careful users check a download | Optional | Free | none wired up; see §4 |

## 1. The updater key (first)

Every update the app installs must be signed with this key; the app checks the signature against the public half built into it and refuses anything else (tested in [M5.md](M5.md) §3 F). **If the private key is lost, installed copies of Logbook can never be updated again**: people would have to download and install a new version by hand. Keep two copies.

1. On your PC (Node.js installed; the repository isn't needed):

   ```
   npx @tauri-apps/cli@2.11.5 signer generate -w ~/.tauri/logbook-updater.key
   ```

   Choose a password when it asks. It writes `logbook-updater.key` (private) and `logbook-updater.key.pub` (public).
2. Add two repository **secrets**:
   - `TAURI_SIGNING_PRIVATE_KEY`: the whole content of `logbook-updater.key` (one line);
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password from step 1.
3. Give the app the **public** key, either way:
   - send me the content of `logbook-updater.key.pub` and I'll put it in `apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`), or
   - add it yourself as the repository **variable** `TAURI_UPDATER_PUBKEY`.

   The public key is safe to publish.
4. Copy `logbook-updater.key` and its password somewhere offline (a password manager, a USB stick in a drawer).

What then happens:

- Every build makes signed update files.
- The release job writes `latest.json`, which points each kind of installer at its update.
- Installed apps find the newest *published* release at `https://github.com/mikehuntskankhunt422-dev/Logbook/releases/latest/download/latest.json`.

If the key secret is set but there's no public key anywhere, the build stops with an error rather than ship an app that could never check its updates.

Every build then verifies its update signatures against the public key the app is built with (`apps/desktop/scripts/verify-signatures.ts`). If the secret holds a different private key, the build fails with "Signed with key …, but the app trusts key …".

**Check:** after the next release, `latest.json` is among its files, and Settings → Updates → "Check for updates" in an older copy offers the new version.

## 2. macOS

You enrol as an **individual**: Apple lists your legal name as the developer. A company would need a D-U-N-S number and legal-entity checks. The signing itself happens on GitHub's Mac runner. The certificate request below needs a Mac, or Keychain Access on someone's Mac.

1. **Enrol** in the Apple Developer Program at developer.apple.com/programs/enroll. You need an Apple Account with two-factor authentication. It's US$99 a year, charged in local currency.
2. **Make the certificate**. Only the account holder can create a *Developer ID Application* certificate.
   1. On a Mac, open Keychain Access → Certificate Assistant → *Request a Certificate From a Certificate Authority*, enter your email, choose *Saved to disk*.
   2. At developer.apple.com/account/resources/certificates, choose **+** → *Developer ID Application*, upload the request, then download the `.cer` and double-click it.
3. **Export it for GitHub**.
   1. In Keychain Access → *My Certificates*, expand "Developer ID Application: <your name> (<team id>)", right-click the key → *Export* → `.p12`, with a password.
   2. Then in Terminal: `openssl base64 -A -in certificate.p12 -out certificate-base64.txt`.
   3. `security find-identity -v -p codesigning` shows the identity's exact name.
4. **Make a notarisation key**.
   1. In App Store Connect → Users and Access → Integrations → App Store Connect API, add a team key with *Developer* access.
   2. Note the **Issuer ID** (above the table) and the **Key ID**.
   3. Download `AuthKey_<id>.p8`. Apple lets you download it **once**.
5. **Add the secrets**:

   | Secret | Value |
   |---|---|
   | `APPLE_CERTIFICATE` | the content of `certificate-base64.txt` |
   | `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
   | `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Jane Citizen (AB12CD34EF)` |
   | `APPLE_API_ISSUER` | the Issuer ID |
   | `APPLE_API_KEY` | the Key ID |
   | `APPLE_API_KEY_P8` | the whole content of the `.p8` file |

   With these, Tauri signs the app with your identity, which overrides the ad-hoc `"-"` in `tauri.conf.json` (checked in the CLI's source). It then sends the app to Apple and staples the notarisation ticket. Without `APPLE_API_KEY_P8` the app is signed but not notarised, which Gatekeeper still blocks.
6. **Check on a Mac**, with the dmg from the release:
   - `spctl -a -vvv -t install /Applications/Logbook.app` should say `accepted` and `source=Notarized Developer ID`;
   - `xcrun stapler validate /Applications/Logbook.app` should say `The validate action worked!`.

**Until then** the app is ad-hoc signed, which Tauri recommends so Apple Silicon doesn't call a downloaded app "damaged". The first time, people open it with right-click → **Open**, or via System Settings → Privacy & Security → **Open Anyway**.

## 3. Windows

What Microsoft says about each option (SmartScreen reputation page, 2026-05-04):

- **Unsigned**: "Windows protected your PC", and the user must choose **More info → Run anyway**. Every new version starts from zero reputation.
- **Signed with an OV or EV certificate**: still an "unrecognised app" warning until the certificate builds reputation, which can take weeks and hundreds of installs. Your verified name is shown, and later versions signed the same way inherit the reputation. EV no longer skips the warning.
- **Microsoft Store**: no warning. But Tauri's Store route lists a normal installer that must itself be signed, so it doesn't avoid buying a certificate.

The routes open to you:

| Route | Who can use it | Cost | Fit |
|---|---|---|---|
| **A. Unsigned** (today) | Anyone | Free | Fine for you and testers |
| **B. OV certificate in your own name**, from a certificate authority that offers **cloud signing** (Certum, SSL.com and others) | Individuals, after an identity check | Varies; I couldn't check current prices from here | The route for an individual in Australia. Keys must live on hardware or in the authority's cloud (since June 2023), so pick a seller whose signing tool runs in CI |
| **C. Azure Artifact Signing** | **Organisations** in Australia (and the US, Canada, EU, UK, NZ, Japan and others); **individuals only in the US or Canada** | About US$10 a month, plus a paid Azure subscription | Cheapest and easiest in CI, but only as a legal business with a website and an email on its own domain (which you'd also need for customer emails, D76). I couldn't confirm whether Microsoft accepts a sole trader (ABN, no company) as an organisation |

**My recommendation:** stay unsigned while only you and testers install it. Before the public launch, choose B if you stay an individual, or C if you set up a company and a domain.

### Route C: Azure Artifact Signing, step by step

1. Create a pay-as-you-go Azure subscription. Free and trial subscriptions are refused.
2. Create an Artifact Signing account (Basic SKU). Note its **endpoint** (shown on the account) and its **name**.
3. Assign yourself the *Artifact Signing Identity Verifier* role. Then do **Identity validation → Organization → Public**: the legal business name, website, a primary email on the business's domain, a business identifier and the address. Microsoft emails a link, valid 7 days. Validation can take days and can't be hurried.
4. Create a **certificate profile** of type *Public Trust* and note its name.
5. Register an app in Microsoft Entra ID and give it a client secret. Grant it *Artifact Signing Certificate Profile Signer* on the account.
6. Add secrets `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_TENANT_ID`, and the **variable** `WINDOWS_SIGN_COMMAND`:

   ```
   artifact-signing-cli -e <endpoint> -a <account name> -c <certificate profile> -d Logbook %1
   ```

   The workflow installs `artifact-signing-cli` 0.11.0 when the command starts with it. It passes the command to Tauri as `bundle.windows.signCommand`, and Tauri runs it on every executable and installer (`%1` is the file).

### Route B: a certificate authority's cloud signing

Each authority has its own command-line signer. Once you've chosen one, I'll add a step that installs it, and you set `WINDOWS_SIGN_COMMAND` to its command with `%1` for the file. Its credentials go in secrets named after the tool's own variables. The rest is the same as route C.

**Check** on Windows, with the installer from the release:

- `Get-AuthenticodeSignature .\Logbook_<version>_x64-setup.exe` should show `Status: Valid` and your name;
- or right-click the file → Properties → Digital Signatures.

## 4. Linux

Nothing has to be signed for Logbook to install or run on Linux, and the updater's own signature already protects automatic updates. What's available, if wanted later (Tauri's Linux signing guide):

- **AppImage**: a gpg signature inside the file (`SIGN=1`, `SIGN_KEY`, `APPIMAGETOOL_SIGN_PASSPHRASE`). But AppImage never checks it itself: people would have to run AppImage's `validate` tool against a key you publish somewhere trustworthy.
- **rpm**: `TAURI_SIGNING_RPM_KEY` and `TAURI_SIGNING_RPM_KEY_PASSPHRASE` (a gpg key). People import your public key with `rpm --import` to check it.
- **deb**: Tauri's documentation doesn't cover signing `.deb` files.

Instead, every release carries `SHA256SUMS.txt`, so a download can be checked by hand (`sha256sum -c SHA256SUMS.txt --ignore-missing`).

## 5. Checklist

- [x] Updater key pair made (2026-10-09), two copies kept; `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` added; public key sent to me or put in `TAURI_UPDATER_PUBKEY`
- [ ] Apple Developer Program; Developer ID Application certificate; App Store Connect API key; six `APPLE_*` secrets
- [ ] Windows route chosen; its secrets and `WINDOWS_SIGN_COMMAND` added
- [ ] A release built after all of the above, and checked on each OS (the "Check" steps above)
