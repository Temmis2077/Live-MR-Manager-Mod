import { describe, expect, it } from 'vitest';
import { parseLrc, parseMarkers, formatMarkerLine, isTriplet, getSyncText } from '../src/js/lrc-parser.js';

describe('parseLrc', () => {
  it('parses timestamped lines', () => {
    const lrc = `[00:12.50]첫 번째 줄\n[00:18.00]두 번째 줄`;
    const segments = parseLrc(lrc, 30);
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe('첫 번째 줄');
    expect(segments[0].start).toBeCloseTo(12.5);
    expect(segments[1].start).toBeCloseTo(18);
    expect(segments[0].end).toBeCloseTo(18);
  });

  it('ignores metadata tags', () => {
    const lrc = `[ar:Artist]\n[00:01.00]가사`;
    const segments = parseLrc(lrc, 10);
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe('가사');
  });

  it('does not misread literal bracketed lyric text as a triplet/marker tag', () => {
    const lrc = `[00:01.00][후렴]가사`;
    const segments = parseLrc(lrc, 10);
    expect(segments[0].text).toBe('[후렴]가사');
    expect(isTriplet(segments[0])).toBe(false);
  });
});

describe('parseLrc triplet cues (원문/차음/번역)', () => {
  it('groups orig/pron/tran lines sharing a timestamp into one segment', () => {
    const lrc = [
      '[00:12.34][orig]忘れられぬものだけが',
      '[00:12.34][pron]와스레라레누 모노 다케가',
      '[00:12.34][tran]잊지 못하는 것만이',
    ].join('\n');
    const segments = parseLrc(lrc, 30);
    expect(segments).toHaveLength(1);
    expect(segments[0].original).toBe('忘れられぬものだけが');
    expect(segments[0].pronunciation).toBe('와스레라레누 모노 다케가');
    expect(segments[0].translation).toBe('잊지 못하는 것만이');
    expect(segments[0].start).toBeCloseTo(12.34);
    expect(isTriplet(segments[0])).toBe(true);
    expect(getSyncText(segments[0])).toBe('와스레라레누 모노 다케가');
  });

  it('does not merge separate unsynced triplet cues that all sit at 00:00', () => {
    const lrc = [
      '[00:00.00][orig]一行目',
      '[00:00.00][pron]첫줄',
      '[00:00.00][tran]번역1',
      '[00:00.00][orig]二行目',
      '[00:00.00][pron]둘째줄',
      '[00:00.00][tran]번역2',
    ].join('\n');
    const segments = parseLrc(lrc, 30);
    expect(segments).toHaveLength(2);
    expect(segments[0].original).toBe('一行目');
    expect(segments[1].original).toBe('二行目');
  });

  it('leaves plain single-line segments as non-triplet', () => {
    const segments = parseLrc('[00:01.00]평범한 가사', 10);
    expect(isTriplet(segments[0])).toBe(false);
    expect(getSyncText(segments[0])).toBe('평범한 가사');
  });
});

describe('parseMarkers', () => {
  it('extracts the vocal start anchor', () => {
    const lrc = `[00:12.34][vocalstart]\n[00:15.00]가사`;
    const markers = parseMarkers(lrc);
    expect(markers.vocalStartSec).toBeCloseTo(12.34);
  });

  it('pairs interlude start/end markers', () => {
    const lrc = `[00:10.00][ilstart]\n[00:25.50][ilend]`;
    const markers = parseMarkers(lrc);
    expect(markers.interludes).toHaveLength(1);
    expect(markers.interludes[0].start).toBeCloseTo(10);
    expect(markers.interludes[0].end).toBeCloseTo(25.5);
  });

  it('pairs multiple interludes in chronological order', () => {
    const lrc = [
      formatMarkerLine(60, 'ilstart'),
      formatMarkerLine(75, 'ilend'),
      formatMarkerLine(120, 'ilstart'),
      formatMarkerLine(140, 'ilend'),
    ].join('\n');
    const markers = parseMarkers(lrc);
    expect(markers.interludes).toHaveLength(2);
    expect(markers.interludes[0]).toMatchObject({ start: 60, end: 75 });
    expect(markers.interludes[1]).toMatchObject({ start: 120, end: 140 });
  });

  it('drops an unpaired trailing ilstart', () => {
    const lrc = `[00:10.00][ilstart]\n[00:25.00][ilend]\n[00:90.00][ilstart]`;
    const markers = parseMarkers(lrc);
    expect(markers.interludes).toHaveLength(1);
  });

  it('does not let marker lines leak into parseLrc segments', () => {
    const lrc = `${formatMarkerLine(5, 'vocalstart')}\n[00:10.00]첫 가사`;
    const segments = parseLrc(lrc, 30);
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe('첫 가사');
  });
});
