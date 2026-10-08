import { readFileSync } from 'node:fs';
import type { CoverDimensions } from '@logbook/core';

/**
 * Cover sizes recorded from Lulu's sandbox `/cover-dimensions/` by `scripts/verify-lulu-packages.ts
 * --record`, for the sample products over the page counts the samples can reach. CI has no Lulu
 * credentials, so the golden tests and the published sample covers use these instead of the
 * guide's formula. Customer covers always ask Lulu (D39).
 */
export const RECORDED_COVER_DIMENSIONS_PATH = new URL('./lulu-cover-dimensions.json', import.meta.url);

export interface RecordedCoverDimensions {
  recorded: string;
  source: string;
  unit: 'mm';
  /** `${podPackageId}@${pages}` → [width, height] */
  sizes: Record<string, [number, number]>;
}

let cache: RecordedCoverDimensions | undefined;

export function recordedCoverDimensions(podPackageId: string, pages: number): CoverDimensions | undefined {
  cache ??= JSON.parse(readFileSync(RECORDED_COVER_DIMENSIONS_PATH, 'utf8')) as RecordedCoverDimensions;
  const size = cache.sizes[`${podPackageId}@${pages}`];
  return size && { width: size[0], height: size[1], unit: cache.unit };
}
