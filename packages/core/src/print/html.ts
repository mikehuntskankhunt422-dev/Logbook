/** Escapes text for HTML content and double-quoted attribute values. Every string from an entry goes through this. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** "example.com/path" from "https://www.example.com/path/" — what a reader types from paper. */
export function shortUrl(url: string): string {
  return url
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '');
}

/** Inches with at most three decimals, for inline styles. */
export function inch(n: number): string {
  return `${Math.round(n * 1000) / 1000}in`;
}

/** Aspect ratio of stored media; 4:3 when an older record has no dimensions. */
export function aspectOf(meta: { width?: number; height?: number } | undefined): { w: number; h: number; known: boolean } {
  return meta?.width && meta.height ? { w: meta.width, h: meta.height, known: true } : { w: 4, h: 3, known: false };
}
