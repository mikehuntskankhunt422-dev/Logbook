import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** The only topic Lulu offers (M4 §1). */
export const LULU_TOPIC = 'PRINT_JOB_STATUS_CHANGED';

/**
 * Checks Lulu's `Lulu-HMAC-SHA256` header: HMAC-SHA256 of the raw body keyed with the API (client)
 * secret, both UTF-8 (ASSUMPTIONS L1). Lulu doesn't say whether the digest is hex or base64 (open
 * question #2), so either encoding of the correct HMAC is accepted; both carry the same 256 bits.
 * Returns the encoding that matched, or null.
 */
export function verifyLuluSignature(rawBody: Buffer, header: string | undefined, secret: string): 'hex' | 'base64' | null {
  const given = header?.trim();
  if (!given || !secret) return null;
  const digest = createHmac('sha256', Buffer.from(secret, 'utf8')).update(rawBody).digest();
  const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  if (same(given.toLowerCase(), digest.toString('hex'))) return 'hex';
  if (same(given, digest.toString('base64'))) return 'base64';
  return null;
}

/**
 * A webhook delivery: `{topic, data}` where `data` is the print job (M4 §1). Only the job's ID and
 * external ID are read; the server then reads the job from Lulu itself (D69).
 */
export const luluWebhookSchema = z.object({
  topic: z.string(),
  data: z.object({ id: z.number(), external_id: z.string().nullable().optional() }).loose(),
});
export type LuluWebhookDelivery = z.infer<typeof luluWebhookSchema>;
