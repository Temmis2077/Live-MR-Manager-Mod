import { describe, expect, it } from 'vitest';
import { filterSongLibrary, getLyricSyncStatus, filterByPlaylist } from '../src/js/library-filters.js';

const sampleSongs = [
  { title: 'Alpha', artist: 'A', source: 'youtube', genre: 'POP', dateAdded: 2, playCount: 1, path: 'a', lyricSyncStatus: 'synced' },
  { title: 'Beta', artist: 'B', source: 'local', genre: 'Ballad', dateAdded: 1, playCount: 5, path: 'b', lyricSyncStatus: 'unsynced' },
  { title: 'Gamma', artist: 'C', source: 'meloming', melomingSongId: 9, genre: 'POP', dateAdded: 3, playCount: 2, path: 'c', lyricSyncStatus: 'none' },
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

  it('filters by lyric sync status', () => {
    expect(filterSongLibrary(sampleSongs, { syncFilter: 'synced' }).map(s => s.title)).toEqual(['Alpha']);
    expect(filterSongLibrary(sampleSongs, { syncFilter: 'unsynced' }).map(s => s.title)).toEqual(['Beta']);
    expect(filterSongLibrary(sampleSongs, { syncFilter: 'none' }).map(s => s.title)).toEqual(['Gamma']);
    expect(filterSongLibrary(sampleSongs, { syncFilter: 'all' })).toHaveLength(3);
  });
});

describe('getLyricSyncStatus', () => {
  it('prefers explicit status field', () => {
    expect(getLyricSyncStatus({ lyricSyncStatus: 'synced' })).toBe('synced');
    expect(getLyricSyncStatus({ lyric_sync_status: 'unsynced' })).toBe('unsynced');
  });
  it('falls back to hasLyrics when status is absent', () => {
    expect(getLyricSyncStatus({ hasLyrics: true })).toBe('unsynced');
    expect(getLyricSyncStatus({ hasLyrics: false })).toBe('none');
    expect(getLyricSyncStatus(null)).toBe('none');
  });
});

describe('filterByPlaylist', () => {
  const lib = [
    { path: 'a.mp3', title: 'A' },
    { path: 'b.mp3', title: 'B' },
    { path: 'c.mp3', title: 'C' },
  ];

  it('returns songs in playlist order, not library order', () => {
    const out = filterByPlaylist(lib, ['c.mp3', 'a.mp3']);
    expect(out.map((s) => s.title)).toEqual(['C', 'A']);
  });

  it('skips paths no longer in the library', () => {
    const out = filterByPlaylist(lib, ['b.mp3', 'deleted.mp3']);
    expect(out.map((s) => s.title)).toEqual(['B']);
  });

  it('handles empty/invalid inputs', () => {
    expect(filterByPlaylist(lib, [])).toEqual([]);
    expect(filterByPlaylist(null, ['a.mp3'])).toEqual([]);
    expect(filterByPlaylist(lib, null)).toEqual([]);
  });
});
