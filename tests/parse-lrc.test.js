import { describe, expect, it } from 'vitest';
import { parseLrc, parseMarkers, formatMarkerLine, isTriplet, getSyncText, encodeLrc, suggestVocalStartFromSegments } from '../src/js/lrc-parser.js';

describe('encodeLrc', () => {
  it('preserves segment order for partially-synced lyrics (no time-sorting)', () => {
    // 위쪽 두 줄은 싱크됨, 아래 두 줄은 아직 미싱크(0초) — 저장/재로드 후에도
    // 미싱크 줄이 위로 올라오지 않고 원래 텍스트 순서가 유지되어야 한다.
    const segments = [
      { text: '싱크된 첫 줄', start: 10, end: 15 },
      { text: '싱크된 둘째 줄', start: 15, end: 0 },
      { text: '미싱크 셋째 줄', start: 0, end: 0 },
      { text: '미싱크 넷째 줄', start: 0, end: 0 },
    ];
    const content = encodeLrc(segments);
    const roundTripped = parseLrc(content, 60);
    expect(roundTripped.map((s) => s.text)).toEqual([
      '싱크된 첫 줄', '싱크된 둘째 줄', '미싱크 셋째 줄', '미싱크 넷째 줄',
    ]);
    expect(roundTripped[0].start).toBeCloseTo(10);
    expect(roundTripped[2].start).toBe(0);
  });

  it('appends marker lines at the end and they still parse', () => {
    const segments = [{ text: '가사', start: 0, end: 0 }];
    const markers = [formatMarkerLine(12.5, 'vocalstart'), formatMarkerLine(60, 'ilstart'), formatMarkerLine(75, 'ilend')];
    const content = encodeLrc(segments, markers);
    const parsedMarkers = parseMarkers(content);
    expect(parsedMarkers.vocalStartSec).toBeCloseTo(12.5);
    expect(parsedMarkers.interludes).toHaveLength(1);
    // 마커 줄이 가사 세그먼트로 새지 않아야 함
    expect(parseLrc(content, 90).map((s) => s.text)).toEqual(['가사']);
  });

  it('round-trips triplet cues', () => {
    const segments = [
      { text: '原文', original: '原文', pronunciation: '차음', translation: '번역', start: 5, end: 0 },
    ];
    const roundTripped = parseLrc(encodeLrc(segments), 30);
    expect(roundTripped).toHaveLength(1);
    expect(isTriplet(roundTripped[0])).toBe(true);
    expect(roundTripped[0].pronunciation).toBe('차음');
    expect(roundTripped[0].start).toBeCloseTo(5);
  });
});

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

describe('suggestVocalStartFromSegments (MV 인트로 감지)', () => {
  it('suggests the earliest synced start minus a lead-in', () => {
    const segments = [
      { text: 'a', start: 12.5, end: 14 },
      { text: 'b', start: 16, end: 18 },
    ];
    expect(suggestVocalStartFromSegments(segments)).toBeCloseTo(12.2);
  });

  it('ignores unsynced (start 0) segments when finding the earliest', () => {
    const segments = [
      { text: 'a', start: 0, end: 0 },
      { text: 'b', start: 20, end: 22 },
      { text: 'c', start: 0, end: 0 },
    ];
    expect(suggestVocalStartFromSegments(segments)).toBeCloseTo(19.7);
  });

  it('returns null when the intro is negligible (below the minimum)', () => {
    const segments = [{ text: 'a', start: 1.2, end: 3 }];
    expect(suggestVocalStartFromSegments(segments)).toBeNull();
  });

  it('returns null when nothing is synced', () => {
    const segments = [{ text: 'a', start: 0, end: 0 }];
    expect(suggestVocalStartFromSegments(segments)).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(suggestVocalStartFromSegments(null)).toBeNull();
    expect(suggestVocalStartFromSegments(undefined)).toBeNull();
  });
});
