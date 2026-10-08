import type { FastifyInstance } from 'fastify';
import { LULU_TOPIC, luluWebhookSchema, verifyLuluSignature } from '../lulu/webhook.ts';
import type { Fulfilment } from './service.ts';

/**
 * Lulu's webhook (PLAN §1.5 step 8), `POST /api/lulu/webhook`. The `Lulu-HMAC-SHA256` header is
 * checked on the raw bytes with the API secret; a verified delivery only asks for a fresh look at the
 * job through Lulu's API (D69), so its body is never trusted for the order's state. Lulu retries a
 * failed delivery 5 times and then switches the subscription off; polling covers that (M4 §2.2).
 */
export function registerLuluWebhook(app: FastifyInstance, fulfilment: Fulfilment, secret: string): void {
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));
    scope.post('/api/lulu/webhook', async (req, reply) => {
      const raw = req.body as Buffer;
      const header = req.headers['lulu-hmac-sha256'];
      const given = typeof header === 'string' ? header : undefined;
      const encoding = verifyLuluSignature(raw, given, secret);
      if (!encoding) {
        // The length tells hex (64) from base64 (44) without logging the value (open question #2).
        req.log.warn({ signatureLength: given?.length ?? 0 }, 'Lulu webhook refused');
        return reply.code(401).send({ error: 'Invalid signature.' });
      }
      let delivery;
      try {
        delivery = luluWebhookSchema.parse(JSON.parse(raw.toString('utf8')));
      } catch {
        return reply.code(400).send({ error: 'Not a Lulu webhook.' });
      }
      const outcome = delivery.topic === LULU_TOPIC ? fulfilment.onWebhook(delivery.data.id, delivery.data.external_id) : 'ignored';
      req.log.info({ luluJob: delivery.data.id, encoding, outcome }, 'Lulu webhook');
      return { received: true, outcome };
    });
  });
}
