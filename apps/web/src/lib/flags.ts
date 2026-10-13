/**
 * Country and region flags for the flag picker (D91): Windows' emoji panel has none. A flag emoji is
 * the region's two letters as regional indicator symbols; the app's flag font draws it.
 */
export interface Flag {
  code: string;
  name: string;
  emoji: string;
}

let cached: Flag[] | null = null;

/** Every region the system knows a name for, in its language, by name. */
export function allFlags(locale = navigator.language): Flag[] {
  if (cached) return cached;
  const names = new Intl.DisplayNames([locale, 'en'], { type: 'region' });
  const flags: Flag[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      // Codes for no real place (private use, unknown) come back as themselves or "Unknown Region".
      if (/^(A[AN]|Q[M-Z]|X[A-Z]|ZZ)$/.test(code)) continue;
      let name: string | undefined;
      try {
        name = names.of(code);
      } catch {
        continue;
      }
      if (!name || name === code || /unknown/i.test(name)) continue;
      flags.push({ code, name, emoji: flagEmoji(code) });
    }
  }
  cached = flags.sort((x, y) => x.name.localeCompare(y.name, locale));
  return cached;
}

/** "JP" → 🇯🇵 */
export function flagEmoji(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
