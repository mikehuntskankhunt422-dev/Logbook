/** Expiring entries in words (D91). */

export function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** How long until it expires, for the journal's cards: "in 3 days". */
export function expiresIn(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const hours = ms / 3_600_000;
  if (Math.abs(hours) < 1) return rtf.format(Math.round(ms / 60_000), 'minute');
  if (Math.abs(hours) < 36) return rtf.format(Math.round(hours), 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}
