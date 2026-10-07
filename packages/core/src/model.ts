import { z } from 'zod';

/** Bumped whenever the stored shape of an entry or media record changes; see migrations.ts. */
export const SCHEMA_VERSION = 1;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const MOODS = ['😄', '🙂', '😐', '😔', '😢', '😠', '😴', '🤩', '🥰', '🤔'] as const;
export type Mood = (typeof MOODS)[number];

export const GRADIENTS = {
  sunrise: { label: 'Sunrise', css: 'linear-gradient(135deg, #ff5f6d 0%, #ffc371 100%)', ink: 'dark' },
  lagoon: { label: 'Lagoon', css: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)', ink: 'light' },
  meadow: { label: 'Meadow', css: 'linear-gradient(135deg, #a8e063 0%, #56ab2f 100%)', ink: 'dark' },
  grape: { label: 'Grape', css: 'linear-gradient(135deg, #8e2de2 0%, #4a00e0 100%)', ink: 'light' },
  peach: { label: 'Peach', css: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)', ink: 'dark' },
  ember: { label: 'Ember', css: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)', ink: 'dark' },
  dusk: { label: 'Dusk', css: 'linear-gradient(135deg, #2c3e50 0%, #fd746c 100%)', ink: 'light' },
  mint: { label: 'Mint', css: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', ink: 'dark' },
  ocean: { label: 'Ocean', css: 'linear-gradient(135deg, #1a2980 0%, #26d0ce 100%)', ink: 'light' },
  bubblegum: { label: 'Bubblegum', css: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', ink: 'dark' },
} as const;
export type GradientId = keyof typeof GRADIENTS;
export const GRADIENT_IDS = Object.keys(GRADIENTS) as GradientId[];

const id = z.string().min(1).max(64);
const caption = z.string().max(2000).default('');

/** ProseMirror/TipTap JSON node. Validated structurally; the editor schema enforces the rest. */
export interface RichNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: RichNode[];
}
export const richNodeSchema: z.ZodType<RichNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    text: z.string().optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    marks: z
      .array(z.object({ type: z.string(), attrs: z.record(z.string(), z.unknown()).optional() }))
      .optional(),
    content: z.array(richNodeSchema).optional(),
  }),
);

export const galleryItemSchema = z.object({ mediaId: id, caption: z.string().max(500).default('') });

export const blockSchema = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('text'), doc: richNodeSchema }),
  z.object({ id, type: z.literal('photo'), mediaId: id, caption }),
  z.object({
    id,
    type: z.literal('gallery'),
    layout: z.enum(['grid', 'collage']),
    items: z.array(galleryItemSchema).max(60),
    caption,
  }),
  z.object({ id, type: z.literal('video'), mediaId: id, caption }),
  z.object({ id, type: z.literal('audio'), mediaId: id, caption }),
  z.object({ id, type: z.literal('file'), mediaId: id, caption }),
  z.object({ id, type: z.literal('link'), url: z.string().url(), title: z.string().max(300).default(''), caption }),
  z.object({
    id,
    type: z.literal('embed'),
    provider: z.enum(['youtube', 'vimeo']),
    videoId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
    url: z.string().url(),
    title: z.string().max(300).default(''),
    caption,
  }),
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block['type'];
export type MediaBlock = Extract<Block, { mediaId: string }>;

export const coverSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gradient'), gradient: z.enum(GRADIENT_IDS as [GradientId, ...GradientId[]]) }),
  z.object({ kind: z.literal('photo'), mediaId: id }),
]);
export type Cover = z.infer<typeof coverSchema>;

export const entrySchema = z.object({
  v: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  id,
  date: z.string().regex(ISO_DATE),
  title: z.string().max(300).default(''),
  mood: z.enum(MOODS).nullable().default(null),
  cover: coverSchema,
  tags: z.array(z.string().min(1).max(40)).max(50).default([]),
  blocks: z.array(blockSchema).max(500),
  createdAt: z.string(),
  updatedAt: z.string(),
  rev: z.number().int().nonnegative(),
  deletedAt: z.string().nullable().default(null),
});
export type Entry = z.infer<typeof entrySchema>;

export const mediaMetaSchema = z.object({
  v: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  id,
  name: z.string().max(255),
  mime: z.string().max(127),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().nonnegative().optional(),
  /** Poster frame for videos, stored as its own media record. */
  posterId: id.optional(),
  /** Set on derived media (poster frames) so garbage collection keeps them with their parent. */
  derivedFrom: id.optional(),
  createdAt: z.string(),
});
export type MediaMeta = z.infer<typeof mediaMetaSchema>;

export const settingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  lastBackupAt: z.string().nullable().default(null),
  changesSinceBackup: z.number().int().nonnegative().default(0),
  /** When the oldest change not covered by a backup happened; drives the gentle reminder. */
  firstUnbackedChangeAt: z.string().nullable().default(null),
  backupReminderDays: z.number().int().min(1).max(365).default(14),
  backupSnoozedUntil: z.string().nullable().default(null),
  autoLockMinutes: z.number().int().min(0).max(240).default(5),
  compressLargeMedia: z.boolean().default(true),
});
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

export function mediaKind(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Every media id an entry references (blocks, gallery items and the photo cover). */
export function referencedMediaIds(entry: Entry): string[] {
  const ids = new Set<string>();
  if (entry.cover.kind === 'photo') ids.add(entry.cover.mediaId);
  for (const b of entry.blocks) {
    if ('mediaId' in b) ids.add(b.mediaId);
    if (b.type === 'gallery') for (const item of b.items) ids.add(item.mediaId);
  }
  return [...ids];
}
