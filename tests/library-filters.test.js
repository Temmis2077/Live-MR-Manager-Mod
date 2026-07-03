import { describe, expect, it } from 'vitest';
import { filterSongLibrary } from '../src/js/library-filters.js';

const sampleSongs = [
  { title: 'Alpha', artist: 'A', source: 'youtube', genre: 'POP', dateAdded: 2, playCount: 1, path: 'a' },
  { title: 'Beta', artist: 'B', source: 'local', genre: 'Ballad', dateAdded: 1, playCount: 5, path: 'b' },
  { title: 'Gamma', artist: 'C', source: 'meloming', melomingSongId: 9, genre: 'POP', dateAdded: 3, playCount: 2, path: 'c' },
];

describe('filterSongLibrary', () => {
  it('filters by tab', () => {
    const youtubeOnly = filterSongLibrary(sampleSongs, { currentTab: 'youtube' });
    expect(youtubeOnly).toHaveLength(1);
    expect(youtubeOnly[0].title).toBe('Alpha');
  });

  it('filters by search query', () => {
    const result = filterSongLibrary(sampleSongs, { query: 'beta' });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Beta');
  });

  it('sorts by play count', () => {
    const result = filterSongLibrary(sampleSongs, { sortBy: 'plays' });
    expect(result[0].title).toBe('Beta');
  });
});
