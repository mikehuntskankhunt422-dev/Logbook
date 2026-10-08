/**
 * Failures injected on purpose, test mode only (`LOGBOOK_FAULTS`, D72): `files-missing` makes the
 * print files look deleted (→ refund), `lulu-down` makes Lulu look unreachable (→ retries, then a
 * person), `lulu-reject` sends Lulu a wrong MD5 so the real sandbox rejects the job (→ refund).
 */
export const FAULTS = ['files-missing', 'lulu-down', 'lulu-reject'] as const;
export type Fault = (typeof FAULTS)[number];
