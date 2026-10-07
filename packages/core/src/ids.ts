const ALPHABET = '0123456789abcdefghijkmnpqrstuvwxyz'; // no l/o to avoid confusion when people read file names

/** Short, URL- and filename-safe random id. 12 chars over 34 symbols ≈ 61 bits. */
export function newId(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Lowercase ASCII slug for human-readable file names; never empty. */
export function slugify(text: string, max = 40): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'entry';
}
