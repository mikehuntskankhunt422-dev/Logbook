import { useSyncExternalStore } from 'react';

/**
 * Talking to the Library's characters in your own words (D116), for anyone with an Anthropic API
 * key of their own: the key stays on this device (browser storage, outside the journal and its
 * backups), and each message goes straight from the app to Anthropic's API with it. Without a key,
 * the characters answer from their list of questions (lib/cast.ts), for free.
 */

export const AI_MODELS = [
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
] as const;
export type AiModel = (typeof AI_MODELS)[number]['value'];

export interface AiPrefs {
  key: string;
  model: AiModel;
  /** What the characters may know: the library's numbers, or the books' titles too. Never their words. */
  share: 'numbers' | 'titles';
}

const DEFAULTS: AiPrefs = { key: '', model: 'claude-opus-5-5', share: 'numbers' };
const KEY = 'logbook.ai';
const listeners = new Set<() => void>();
let current = load();

function load(): AiPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof AiPrefs, unknown>>;
    return {
      key: typeof raw.key === 'string' ? raw.key.trim() : '',
      model: AI_MODELS.some((m) => m.value === raw.model) ? (raw.model as AiModel) : DEFAULTS.model,
      share: raw.share === 'titles' ? 'titles' : 'numbers',
    };
  } catch {
    return DEFAULTS;
  }
}

export function aiPrefs(): AiPrefs {
  return current;
}

export function setAiPrefs(patch: Partial<AiPrefs>): void {
  current = { ...load(), ...patch };
  try {
    if (current.key || current.model !== DEFAULTS.model || current.share !== DEFAULTS.share) localStorage.setItem(KEY, JSON.stringify(current));
    else localStorage.removeItem(KEY);
  } catch {
    // Private browsing: it lasts until the page closes.
  }
  for (const l of listeners) l();
}

if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    current = load();
    for (const l of listeners) l();
  });

export function useAiPrefs(): AiPrefs {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}

export interface Said {
  role: 'user' | 'assistant';
  text: string;
}

/** What came back: their words, or why there are none. */
export type Answer = { ok: true; text: string } | { ok: false; why: string };

/**
 * One turn of a conversation with a character, through Claude: who they are (`system`), and what's
 * been said so far, ending with what was just asked. The SDK is loaded the first time.
 */
export async function ask(prefs: AiPrefs, system: string, said: readonly Said[]): Promise<Answer> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: prefs.key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 60_000 });
  try {
    const response = await client.beta.messages.create({
      model: prefs.model,
      max_tokens: 2048,
      system,
      messages: said.map((s) => ({ role: s.role, content: s.text })),
      // A few sentences of conversation: little thinking needed.
      output_config: { effort: 'low' },
      // A request one model declines is tried again on another, server-side (not offered for Haiku).
      ...(prefs.model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
    });
    if (response.stop_reason === 'refusal') return { ok: false, why: 'They won’t answer that one. Try asking something else.' };
    const text = response.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('')
      .trim();
    return text ? { ok: true, text } : { ok: false, why: 'They didn’t say anything. Try again.' };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, why: 'That API key didn’t work. Check it in Settings → AI characters.' };
    if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, why: 'This API key isn’t allowed to use that model. Pick another in Settings → AI characters.' };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, why: 'Too many messages for now. Wait a little and try again.' };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, why: 'Couldn’t reach Anthropic. Are you online?' };
    if (err instanceof Anthropic.APIError) return { ok: false, why: `Anthropic’s API couldn’t answer (${err.status ?? 'no status'}). Try again in a while.` };
    return { ok: false, why: 'Something went wrong talking to them. Try again.' };
  }
}
