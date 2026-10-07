export interface ParsedEmbed {
  provider: 'youtube' | 'vimeo';
  videoId: string;
  url: string;
}

/** Recognises YouTube and Vimeo URLs. Returns null for anything else (it becomes a plain link block). */
export function parseEmbedUrl(raw: string): ParsedEmbed | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const segs = u.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' && segs[0]) return yt(segs[0]);
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    if (segs[0] === 'watch') return yt(u.searchParams.get('v'));
    if (['embed', 'shorts', 'live', 'v'].includes(segs[0] ?? '')) return yt(segs[1]);
  }
  if (host === 'vimeo.com') {
    const idSeg = segs.find((s) => /^\d+$/.test(s));
    return idSeg ? { provider: 'vimeo', videoId: idSeg, url: `https://vimeo.com/${idSeg}` } : null;
  }
  if (host === 'player.vimeo.com' && segs[0] === 'video' && segs[1] && /^\d+$/.test(segs[1])) {
    return { provider: 'vimeo', videoId: segs[1], url: `https://vimeo.com/${segs[1]}` };
  }
  return null;
}

function yt(id: string | null | undefined): ParsedEmbed | null {
  if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
  return { provider: 'youtube', videoId: id, url: `https://www.youtube.com/watch?v=${id}` };
}

/** Privacy-friendlier player URLs: youtube-nocookie and Vimeo's do-not-track flag. */
export function embedPlayerUrl(e: { provider: 'youtube' | 'vimeo'; videoId: string }): string {
  return e.provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${e.videoId}`
    : `https://player.vimeo.com/video/${e.videoId}?dnt=1`;
}
