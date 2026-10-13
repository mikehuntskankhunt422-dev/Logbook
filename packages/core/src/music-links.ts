/**
 * Background music from a link (D93): a video or live stream on a site with an embeddable player,
 * an audio or video file, or an internet radio stream. Sites' players stay visible (their terms
 * ask for that: YouTube's, for one, forbids playing its audio without its player).
 */

export type MusicSource =
  /** A site's own player, in a frame. `src` is the player's address, without autoplay. */
  | { kind: 'player'; site: string; src: string; url: string; youtubeId?: string }
  /** A Rumble page: its player's address has to be looked up (Rumble's oEmbed). */
  | { kind: 'rumble-page'; site: 'Rumble'; url: string }
  /** Anything else: tried as an audio stream or file, and opened in the browser if it won't play. */
  | { kind: 'stream'; site: string; url: string };

/** The web address the person pasted, made whole ("youtu.be/…" works too), or null. */
export function normaliseMusicUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 2000) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u.href;
  } catch {
    return null;
  }
}

/** What a (normalised) link is, and how to play it. */
export function musicSource(href: string): MusicSource {
  const u = new URL(href);
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const segs = u.pathname.split('/').filter(Boolean);
  const site = host;

  // YouTube: videos, live streams (/live/ID), Shorts, YouTube Music.
  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    const id = host === 'youtu.be' ? segs[0] : segs[0] === 'watch' ? u.searchParams.get('v') : ['embed', 'shorts', 'live', 'v'].includes(segs[0] ?? '') ? segs[1] : null;
    if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id))
      // A video loops (a playlist of itself); a live stream simply goes on.
      return { kind: 'player', site: 'YouTube', url: href, youtubeId: id, src: `https://www.youtube-nocookie.com/embed/${id}?loop=1&playlist=${id}&playsinline=1&rel=0&enablejsapi=1` };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = segs.find((s) => /^\d+$/.test(s));
    if (id) return { kind: 'player', site: 'Vimeo', url: href, src: `https://player.vimeo.com/video/${id}?dnt=1&loop=1` };
  }
  if (host === 'rumble.com') {
    if (segs[0] === 'embed' && segs[1] && /^[a-z0-9]+$/i.test(segs[1])) return { kind: 'player', site: 'Rumble', url: href, src: `https://rumble.com/embed/${segs[1]}/` };
    if (segs[0] && /^v[a-z0-9]+-/i.test(segs[0])) return { kind: 'rumble-page', site: 'Rumble', url: href };
  }
  if (host === 'dailymotion.com' || host === 'dai.ly') {
    const id = host === 'dai.ly' ? segs[0] : segs[0] === 'video' ? segs[1] : segs[0] === 'embed' && segs[1] === 'video' ? segs[2] : undefined;
    const clean = id?.split('_')[0];
    if (clean && /^[a-z0-9]+$/i.test(clean)) return { kind: 'player', site: 'Dailymotion', url: href, src: `https://www.dailymotion.com/embed/video/${clean}` };
  }
  if (host === 'twitch.tv') {
    // Twitch's player needs the page's own host name.
    const parent = typeof location === 'undefined' ? 'localhost' : location.hostname || 'localhost';
    if (segs[0] === 'videos' && segs[1] && /^\d+$/.test(segs[1])) return { kind: 'player', site: 'Twitch', url: href, src: `https://player.twitch.tv/?video=v${segs[1]}&parent=${encodeURIComponent(parent)}` };
    if (segs[0] && /^[a-z0-9_]{3,25}$/i.test(segs[0]) && segs.length === 1) return { kind: 'player', site: 'Twitch', url: href, src: `https://player.twitch.tv/?channel=${segs[0]}&parent=${encodeURIComponent(parent)}` };
  }
  if (host === 'kick.com' && segs.length === 1 && /^[a-z0-9_-]{2,30}$/i.test(segs[0]!)) return { kind: 'player', site: 'Kick', url: href, src: `https://player.kick.com/${segs[0]}` };
  if (host === 'streamable.com' && segs[0]) {
    const id = segs[0] === 'e' ? segs[1] : segs[0];
    if (id && /^[a-z0-9]+$/i.test(id)) return { kind: 'player', site: 'Streamable', url: href, src: `https://streamable.com/e/${id}?loop=1` };
  }
  return { kind: 'stream', site, url: href };
}

/** Adds the "start playing" switch to a player's address. */
export function withAutoplay(src: string): string {
  return `${src}${src.includes('?') ? '&' : '?'}autoplay=1`;
}
