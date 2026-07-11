import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mergeAlignmentResult } from '../src/js/lrc-parser.js';

// alignment-queue.js가 끌어오는 앱 전역 의존성(tauri invoke, state, UI 갱신)을
// 전부 목으로 대체 — 순차 처리 로직만 격리해서 검증한다.
vi.mock('../src/js/tauri-bridge.js', () => ({
  invoke: vi.fn(),
  listen: vi.fn(async () => () => {}),
}));
vi.mock('../src/js/state.js', () => ({
  state: { alignmentQueue: [], songLibrary: [] },
}));
vi.mock('../src/js/ui/components.js', () => ({
  updateTaskUI: vi.fn(),
}));

import { invoke } from '../src/js/tauri-bridge.js';
import { state } from '../src/js/state.js';
import { enqueueAlignment } from '../src/js/alignment-queue.js';

describe('mergeAlignmentResult', () => {
  it('fills only fully-unsynced segments and marks them approx', () => {
    const segments = [
      { text: '이미 싱크된 줄', start: 5, end: 8 },
      { text: '미싱크 줄', start: 0, end: 0 },
    ];
    const lines = [
      { text: '이미 싱크된 줄', start_ms: 1000, end_ms: 2000 },
      { text: '미싱크 줄', start_ms: 10000, end_ms: 12000 },
    ];
    const applied = mergeAlignmentResult(segments, lines);
    expect(applied).toBe(1);
    // 기존 수동 싱크는 절대 건드리지 않음
    expect(segments[0].start).toBe(5);
    expect(segments[0].end).toBe(8);
    expect(segments[0].approx).toBeUndefined();
    // 미싱크 줄만 채워지고 approx 마킹
    expect(segments[1].start).toBeCloseTo(10);
    expect(segments[1].end).toBeCloseTo(12);
    expect(segments[1].approx).toBe(true);
  });

  it('matches triplet cues by pronunciation (sync text)', () => {
    const segments = [
      { original: '忘れられぬ', pronunciation: '와스레라레누', translation: '잊지 못하는', text: '忘れられぬ', start: 0, end: 0 },
    ];
    const lines = [{ text: '와스레라레누', start_ms: 3000, end_ms: 5000 }];
    const applied = mergeAlignmentResult(segments, lines);
    expect(applied).toBe(1);
    expect(segments[0].start).toBeCloseTo(3);
  });

  it('returns 0 for empty inputs without throwing', () => {
    expect(mergeAlignmentResult([], [])).toBe(0);
    expect(mergeAlignmentResult(null, null)).toBe(0);
  });

  it('does not reuse one alignment line for two identical lyric lines', () => {
    const segments = [
      { text: '후렴', start: 0, end: 0 },
      { text: '후렴', start: 0, end: 0 },
    ];
    const lines = [
      { text: '후렴', start_ms: 1000, end_ms: 2000 },
      { text: '후렴', start_ms: 9000, end_ms: 10000 },
    ];
    expect(mergeAlignmentResult(segments, lines)).toBe(2);
    expect(segments[0].start).toBeCloseTo(1);
    expect(segments[1].start).toBeCloseTo(9);
  });
});

describe('alignment queue sequential processor', () => {
  const flushQueue = async () => {
    // 대기열이 완전히 소진될 때까지 대기 (queued/processing 항목이 없어질 때까지)
    for (let i = 0; i < 200; i++) {
      const busy = state.alignmentQueue.some((it) => it.status === 'queued' || it.status === 'processing');
      if (!busy) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('queue did not drain');
  };

  beforeEach(() => {
    state.alignmentQueue.length = 0;
    state.songLibrary.length = 0;
    invoke.mockReset();
  });

  it('processes items strictly one at a time and skips no-lyrics songs', async () => {
    const log = [];
    const lrcByPath = {
      'song-a': '[00:00.00]가사 한 줄',
      'song-b': '', // 가사 없음 — run_forced_alignment까지 가면 안 됨
      'song-c': '[00:00.00]다른 가사',
    };

    invoke.mockImplementation(async (cmd, args) => {
      switch (cmd) {
        case 'load_lrc_file':
          return lrcByPath[args.audioPath] ?? '';
        case 'get_model_list':
          return ['한국어 모델|/models/dir'];
        case 'run_forced_alignment': {
          log.push(`align-start:${args.audioPath}`);
          await new Promise((r) => setTimeout(r, 20));
          log.push(`align-end:${args.audioPath}`);
          const firstLine = args.lyrics.split('\n')[0];
          return { lines: [{ text: firstLine, start_ms: 1000, end_ms: 2000 }] };
        }
        case 'save_lrc_file':
          log.push(`save:${args.audioPath}`);
          return 'ok';
        default:
          return null;
      }
    });

    enqueueAlignment(['song-a', 'song-b', 'song-c']);
    await flushQueue();

    // song-b는 가사가 없어 정렬 자체가 호출되지 않아야 함
    expect(log.filter((l) => l.includes('song-b'))).toHaveLength(0);
    expect(state.alignmentQueue.find((i) => i.path === 'song-b').status).toBe('no-lyrics');

    // 엄격한 순차: a의 정렬+저장이 모두 끝난 뒤에야 c의 정렬이 시작
    expect(log).toEqual([
      'align-start:song-a',
      'align-end:song-a',
      'save:song-a',
      'align-start:song-c',
      'align-end:song-c',
      'save:song-c',
    ]);

    expect(state.alignmentQueue.find((i) => i.path === 'song-a').status).toBe('done');
    expect(state.alignmentQueue.find((i) => i.path === 'song-c').status).toBe('done');
  });

  it('marks an item error when no alignment model is installed and continues the batch', async () => {
    invoke.mockImplementation(async (cmd, args) => {
      switch (cmd) {
        case 'load_lrc_file':
          return '[00:00.00]가사';
        case 'get_model_list':
          return ['설치 안 된 모델|none']; // 사용 가능 모델 없음
        default:
          return null;
      }
    });

    enqueueAlignment(['song-x']);
    await flushQueue();

    const item = state.alignmentQueue.find((i) => i.path === 'song-x');
    expect(item.status).toBe('error');
    expect(item.error).toContain('모델');
  });

  it('dedupes paths already queued', () => {
    invoke.mockImplementation(async () => '');
    const first = enqueueAlignment(['dup-song']);
    const second = enqueueAlignment(['dup-song']);
    expect(first).toBe(1);
    expect(second).toBe(0);
  });
});
