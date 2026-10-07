import { exportBackup, Journal, MemoryStore, type BookOptions } from '@logbook/core';
import { generateSample, type SampleKind } from './generate.ts';
import { SAMPLE_PRODUCTS, type SampleProductId } from './products.ts';

/**
 * A sample journal as a Logbook backup zip, so the web app can restore it and lay the same book out
 * in its preview (M2 §5, preview parity). Videos, voice notes and PDFs in the samples are metadata
 * only; they get a few placeholder bytes, which is all layout needs (it reads stored dimensions).
 */
export async function sampleBackup(kind: SampleKind, productId: SampleProductId): Promise<{ zip: Buffer; options: BookOptions }> {
  const sample = await generateSample(kind, SAMPLE_PRODUCTS[productId]);
  const journal = await Journal.open(new MemoryStore());
  for (const meta of sample.media.values()) {
    const bytes = sample.files.get(meta.id) ?? Buffer.from(`placeholder for ${meta.name}`);
    await journal.importMedia(meta, new Blob([new Uint8Array(bytes)], { type: meta.mime }));
  }
  for (const entry of sample.entries) await journal.importEntry(entry);
  const zip = Buffer.from(await (await exportBackup(journal, { app: `logbook-sample ${kind}` })).arrayBuffer());
  return { zip, options: sample.options };
}
