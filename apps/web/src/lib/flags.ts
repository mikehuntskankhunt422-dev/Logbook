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

/**
 * The flags the bundled flag font draws (Twemoji Country Flags, read from its ligatures): only
 * these are offered, as any other pair of letters would show as just the letters. Browsers know
 * more names than there are flags: old codes kept as aliases (UK, SU, YU…), the Eurozone, and Sark,
 * whose flag came to emoji after this font.
 */
const FONT_FLAGS = `
  AC AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR
  BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CP CR CU CV CW CX CY CZ DE DG DJ DK DM DO
  DZ EA EC EE EG EH ER ES ET EU FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT
  GU GW GY HK HM HN HR HT HU IC ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR
  KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU
  MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
  QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TA TC TD TF TG
  TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM UN US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA
  ZM ZW
`.trim().split(/\s+/);

/** Every flag the app can draw, named in the person's language, by name. */
export function allFlags(locale = navigator.language): Flag[] {
  if (cached) return cached;
  const names = new Intl.DisplayNames([locale, 'en'], { type: 'region' });
  const flags: Flag[] = [];
  for (const code of FONT_FLAGS) {
    let name: string | undefined;
    try {
      name = names.of(code);
    } catch {
      continue;
    }
    if (!name || name === code || /unknown/i.test(name)) continue;
    flags.push({ code, name, emoji: flagEmoji(code) });
  }
  cached = flags.sort((x, y) => x.name.localeCompare(y.name, locale));
  return cached;
}

/** "JP" → 🇯🇵 */
export function flagEmoji(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
