import { describe, expect, it } from 'vitest';
import { musicSource, normaliseMusicUrl, withAutoplay } from '../src/music-links.ts';

const src = (raw: string) => musicSource(normaliseMusicUrl(raw)!);

describe('music from a link (D93)', () => {
  it('takes a pasted address, with or without https://, and nothing that isn’t a web address', () => {
    expect(normaliseMusicUrl(' youtu.be/jfKfPfyJRdk ')).toBe('https://youtu.be/jfKfPfyJRdk');
    expect(normaliseMusicUrl('http://radio.example.org:8000/stream')).toBe('http://radio.example.org:8000/stream');
    expect(normaliseMusicUrl('javascript:alert(1)')).toBeNull();
    expect(normaliseMusicUrl('lofi girl')).toBeNull();
    expect(normaliseMusicUrl('')).toBeNull();
  });

  it('plays YouTube videos and live streams in YouTube’s own player', () => {
    for (const link of ['https://www.youtube.com/watch?v=jfKfPfyJRdk', 'youtu.be/jfKfPfyJRdk', 'https://www.youtube.com/live/jfKfPfyJRdk?si=x', 'https://m.youtube.com/watch?v=jfKfPfyJRdk&t=3']) {
      const s = src(link);
      expect(s.kind).toBe('player');
      expect(s.kind === 'player' && s.youtubeId).toBe('jfKfPfyJRdk');
      expect(s.kind === 'player' && s.src).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/jfKfPfyJRdk\?loop=1&playlist=jfKfPfyJRdk/);
    }
  });

  it('knows Vimeo, Rumble, Dailymotion, Twitch, Kick and Streamable', () => {
    expect(src('https://vimeo.com/76979871')).toMatchObject({ kind: 'player', site: 'Vimeo', src: 'https://player.vimeo.com/video/76979871?dnt=1&loop=1' });
    expect(src('https://rumble.com/embed/v4abc12/?pub=4')).toMatchObject({ kind: 'player', site: 'Rumble', src: 'https://rumble.com/embed/v4abc12/' });
    expect(src('https://rumble.com/v4l0q8g-some-video.html')).toMatchObject({ kind: 'rumble-page' });
    expect(src('https://www.dailymotion.com/video/x8abc12_title')).toMatchObject({ kind: 'player', site: 'Dailymotion', src: 'https://www.dailymotion.com/embed/video/x8abc12' });
    expect(src('https://www.twitch.tv/somechannel')).toMatchObject({ kind: 'player', site: 'Twitch' });
    expect(src('https://www.twitch.tv/somechannel').kind === 'player' && (src('https://www.twitch.tv/somechannel') as { src: string }).src).toMatch(/channel=somechannel&parent=/);
    expect(src('https://kick.com/somechannel')).toMatchObject({ kind: 'player', site: 'Kick', src: 'https://player.kick.com/somechannel' });
    expect(src('https://streamable.com/abc123')).toMatchObject({ kind: 'player', site: 'Streamable', src: 'https://streamable.com/e/abc123?loop=1' });
  });

  it('tries anything else as a stream or file', () => {
    expect(src('https://example.com/song.mp3')).toMatchObject({ kind: 'stream', site: 'example.com' });
    expect(src('http://radio.example.org:8000/stream')).toMatchObject({ kind: 'stream' });
    expect(src('https://www.youtube.com/@LofiGirl')).toMatchObject({ kind: 'stream' });
    expect(withAutoplay('https://a.example/x')).toBe('https://a.example/x?autoplay=1');
    expect(withAutoplay('https://a.example/x?y=1')).toBe('https://a.example/x?y=1&autoplay=1');
  });
});
