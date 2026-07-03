import { describe, expect, it } from 'vitest';
import {
  extractYoutubeVideoId,
  normalizeYoutubeKey,
  normalizeYoutubeUrl,
  youtubePathsMatch,
  isDuplicateYoutubeTrack,
} from '../src/js/youtube-utils.js';

describe('youtube-utils', () => {
  it('extracts id from youtu.be URL', () => {
    expect(extractYoutubeVideoId('https://youtu.be/abc123?t=10')).toBe('abc123');
  });

  it('extracts id from watch URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=xyz789&list=foo')).toBe('xyz789');
  });

  it('extracts id from shorts URL', () => {
    expect(extractYoutubeVideoId('https://youtube.com/shorts/short1')).toBe('short1');
  });

  it('normalizes youtube key', () => {
    expect(normalizeYoutubeKey('https://youtu.be/abc123')).toBe('yt:abc123');
  });

  it('normalizes youtube url', () => {
    expect(normalizeYoutubeUrl('https://www.youtube.com/watch?v=abc123&list=foo')).toBe('https://youtu.be/abc123');
  });

  it('matches equivalent youtube paths', () => {
    expect(youtubePathsMatch('https://youtu.be/abc', 'https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(youtubePathsMatch('https://youtu.be/abc', 'https://youtu.be/def')).toBe(false);
  });

  it('detects duplicate youtube tracks', () => {
    const library = [{ path: 'https://youtu.be/abc', title: 'Song' }];
    expect(isDuplicateYoutubeTrack(library, 'https://www.youtube.com/watch?v=abc', null)).toBe(true);
    expect(isDuplicateYoutubeTrack(library, 'https://youtu.be/new', null)).toBe(false);
  });
});
