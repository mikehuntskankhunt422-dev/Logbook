import { useSyncExternalStore } from 'react';

/**
 * Talking to the Library's characters in your own words (D116, D118), for anyone with an API key
 * of their own from Anthropic (Claude), OpenAI (ChatGPT), Google (Gemini), xAI (Grok) or
 * OpenRouter. Each provider's key stays on this device (browser storage, outside the journal and
 * its backups), and each message goes straight to that provider with it: Claude's through
 * Anthropic's own SDK; the others through their OpenAI-style chat API, which the desktop app sends
 * from its Rust side (to those four addresses only, `ai_request`), and a browser or the Android
 * app from the page. Without a key, the characters answer from their list (lib/cast.ts), for free.
 */

export const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)', keyLooks: 'sk-ant-…', base: '' },
  { id: 'openai', name: 'OpenAI (ChatGPT)', keyLooks: 'sk-…', base: 'https://api.openai.com/v1' },
  { id: 'gemini', name: 'Google (Gemini)', keyLooks: 'AIza…', base: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'xai', name: 'xAI (Grok)', keyLooks: 'xai-…', base: 'https://api.x.ai/v1' },
  { id: 'openrouter', name: 'OpenRouter', keyLooks: 'sk-or-…', base: 'https://openrouter.ai/api/v1' },
] as const;
export type ProviderId = (typeof PROVIDERS)[number]['id'];
export const provider = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!;

/** Claude's models, to choose from; the other providers' come from the provider itself. */
export const AI_MODELS = [
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
] as const;
export type AiModel = (typeof AI_MODELS)[number]['value'];

export interface AiPrefs {
  /** Whose AI the characters talk through. */
  provider: ProviderId;
  /** Each provider's key, kept while another is chosen. */
  keys: Partial<Record<ProviderId, string>>;
  /** Each provider's model: Claude's from AI_MODELS; the others' as the provider names them. */
  models: Partial<Record<ProviderId, string>>;
  /** What the characters may know: the library's numbers, or the books' titles too. Never their words. */
  share: 'numbers' | 'titles';
}

const DEFAULTS: AiPrefs = { provider: 'anthropic', keys: {}, models: {}, share: 'numbers' };
const KEY = 'logbook.ai';
const listeners = new Set<() => void>();
let current = load();

/** What was saved, cleaned of anything that doesn't fit (and 0.9.12's Claude-only shape, read as Claude's). */
function load(): AiPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const keys: AiPrefs['keys'] = {};
    const models: AiPrefs['models'] = {};
    const rawKeys = (raw.keys && typeof raw.keys === 'object' ? raw.keys : {}) as Record<string, unknown>;
    const rawModels = (raw.models && typeof raw.models === 'object' ? raw.models : {}) as Record<string, unknown>;
    if (typeof raw.key === 'string' && rawKeys.anthropic === undefined) rawKeys.anthropic = raw.key;
    if (typeof raw.model === 'string' && rawModels.anthropic === undefined) rawModels.anthropic = raw.model;
    for (const p of PROVIDERS) {
      const k = rawKeys[p.id];
      if (typeof k === 'string' && k.trim()) keys[p.id] = k.trim();
      const m = rawModels[p.id];
      if (typeof m === 'string' && m.trim()) models[p.id] = m.trim().slice(0, 200);
    }
    if (models.anthropic && !AI_MODELS.some((m) => m.value === models.anthropic)) delete models.anthropic;
    return {
      provider: PROVIDERS.some((p) => p.id === raw.provider) ? (raw.provider as ProviderId) : 'anthropic',
      keys,
      models,
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
  const empty = !Object.keys(current.keys).length && !Object.keys(current.models).length && current.provider === 'anthropic' && current.share === 'numbers';
  try {
    if (empty) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private browsing: it lasts until the page closes.
  }
  for (const l of listeners) l();
}

/** One provider's key (empty to remove it). */
export function setAiKey(id: ProviderId, key: string): void {
  const keys = { ...load().keys };
  if (key.trim()) keys[id] = key.trim();
  else delete keys[id];
  setAiPrefs({ keys });
}

/** One provider's model. */
export function setAiModel(id: ProviderId, model: string): void {
  const models = { ...load().models };
  if (model.trim()) models[id] = model.trim().slice(0, 200);
  else delete models[id];
  setAiPrefs({ models });
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

/** The chosen provider's model: Claude Opus 5.5 unless another is chosen; the others' must be chosen. */
export const modelOf = (prefs: AiPrefs): string => prefs.models[prefs.provider] ?? (prefs.provider === 'anthropic' ? 'claude-opus-5-5' : '');
/** Whether the characters can talk in your own words: a key for the chosen provider, and its model. */
export const aiReady = (prefs: AiPrefs): boolean => Boolean(prefs.keys[prefs.provider] && modelOf(prefs));

export interface Said {
  role: 'user' | 'assistant';
  text: string;
}

/** What came back: their words, or why there are none. */
export type Answer = { ok: true; text: string } | { ok: false; why: string };

/** One turn of a conversation with a character: who they are (`system`), and what's been said so far, ending with what was just asked. */
export async function ask(prefs: AiPrefs, system: string, said: readonly Said[]): Promise<Answer> {
  const key = prefs.keys[prefs.provider];
  const model = modelOf(prefs);
  if (!key) return { ok: false, why: `There's no ${provider(prefs.provider).name} key on this device. Add one in Settings → AI characters.` };
  if (!model) return { ok: false, why: `Pick a model for ${provider(prefs.provider).name} in Settings → AI characters.` };
  return prefs.provider === 'anthropic' ? askClaude(key, model as AiModel, system, said) : askCompatible(prefs.provider, key, model, system, said);
}

/** Claude, through Anthropic's SDK (loaded the first time). */
async function askClaude(key: string, model: AiModel, system: string, said: readonly Said[]): Promise<Answer> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 60_000 });
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 2048,
      system,
      messages: said.map((s) => ({ role: s.role, content: s.text })),
      // A few sentences of conversation: little thinking needed.
      output_config: { effort: 'low' },
      // A request one model declines is tried again on another, server-side (not offered for Haiku).
      ...(model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
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

/** A provider's reply, as status and text. */
interface Reply {
  status: number;
  body: string;
}

/**
 * A request to one of the OpenAI-style providers: from the desktop app's Rust side (which only
 * reaches these providers, and isn't subject to a browser's cross-origin rules), else from the page.
 */
async function send(method: 'GET' | 'POST', url: string, key: string, body?: string): Promise<Reply> {
  if (import.meta.env.VITE_PLATFORM === 'desktop') {
    const { invoke } = await import('../desktop/ipc.ts');
    return invoke<Reply>('ai_request', { method, url, key, body: body ?? null });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body, signal: controller.signal });
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/** What a provider said went wrong, if it said (OpenAI's shape, or Gemini's in a list). */
function providerMessage(body: string): string {
  try {
    const data = JSON.parse(body) as unknown;
    const first = Array.isArray(data) ? (data[0] as unknown) : data;
    const message = (first as { error?: { message?: unknown } })?.error?.message;
    return typeof message === 'string' ? message.trim().slice(0, 240) : '';
  } catch {
    return '';
  }
}

/** Why a request failed, in a sentence: the status first, the provider's own words when they help. */
function failure(name: string, reply: Reply): string {
  const said = providerMessage(reply.body);
  if (reply.status === 401 || reply.status === 403) return `That ${name} key didn’t work. Check it in Settings → AI characters.`;
  if (reply.status === 404) return `${name} doesn’t know that model${said ? ` (“${said}”)` : ''}. Pick another in Settings → AI characters.`;
  if (reply.status === 429) return `Too many messages for now, or the key’s credit has run out${said ? ` (“${said}”)` : ''}. Try again in a while.`;
  return `${name} couldn’t answer (${reply.status})${said ? `: “${said}”` : ''}.`;
}

/** OpenAI, Gemini, xAI or OpenRouter, through their OpenAI-style chat API. */
async function askCompatible(id: Exclude<ProviderId, 'anthropic'>, key: string, model: string, system: string, said: readonly Said[]): Promise<Answer> {
  const { name, base } = provider(id);
  const body = JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...said.map((s) => ({ role: s.role, content: s.text }))] });
  let reply: Reply;
  try {
    reply = await send('POST', `${base}/chat/completions`, key, body);
  } catch {
    return { ok: false, why: `Couldn’t reach ${name}. Are you online?` };
  }
  if (reply.status < 200 || reply.status >= 300) return { ok: false, why: failure(name, reply) };
  try {
    const data = JSON.parse(reply.body) as { choices?: { message?: { content?: unknown; refusal?: unknown } }[] };
    const message = data.choices?.[0]?.message;
    if (typeof message?.refusal === 'string' && message.refusal) return { ok: false, why: 'They won’t answer that one. Try asking something else.' };
    const content = message?.content;
    const text = (typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: { text?: unknown }) => (typeof p?.text === 'string' ? p.text : '')).join('') : '').trim();
    return text ? { ok: true, text } : { ok: false, why: 'They didn’t say anything. Try again.' };
  } catch {
    return { ok: false, why: `${name} sent back something Logbook couldn’t read. Try again.` };
  }
}

/** A provider's models, to choose from (OpenAI-style `/models`), by name. */
export async function listModels(id: Exclude<ProviderId, 'anthropic'>, key: string): Promise<{ ok: true; models: string[] } | { ok: false; why: string }> {
  const { name, base } = provider(id);
  let reply: Reply;
  try {
    reply = await send('GET', `${base}/models`, key);
  } catch {
    return { ok: false, why: `Couldn’t reach ${name}. Are you online?` };
  }
  if (reply.status < 200 || reply.status >= 300) return { ok: false, why: failure(name, reply) };
  try {
    const data = JSON.parse(reply.body) as { data?: { id?: unknown }[] };
    // Gemini names them "models/…"; its chat API wants the name alone.
    const models = [...new Set((data.data ?? []).flatMap((m) => (typeof m.id === 'string' ? [m.id.replace(/^models\//, '')] : [])))].sort();
    return models.length ? { ok: true, models } : { ok: false, why: `${name} didn’t list any models for this key.` };
  } catch {
    return { ok: false, why: `${name} sent back something Logbook couldn’t read.` };
  }
}
