import { describe, expect, it, beforeEach, vi } from 'vitest';

// localStorage 목 (jsdom 없이 순수 로직 테스트)
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

import {
  getAlignmentLanguage,
  setAlignmentLanguage,
  findModelForLanguage,
  requiredLanguagesFor,
  dominantScriptLang,
  mergeDualAlignmentLines,
  ALIGNMENT_LANGUAGES,
} from '../src/js/alignment-model.js';

describe('alignment language selection', () => {
  beforeEach(() => { for (const k in store) delete store[k]; });

  it('defaults to ko and persists valid values', () => {
    expect(getAlignmentLanguage()).toBe('ko');
    setAlignmentLanguage('en');
    expect(getAlignmentLanguage()).toBe('en');
    setAlignmentLanguage('invalid');
    expect(getAlignmentLanguage()).toBe('en'); // 잘못된 값은 무시
  });
});

describe('findModelForLanguage', () => {
  const models = [
    '한국어 가사 정렬 모델|C:\\Users\\x\\models\\wav2vec2-korean-lyrics',
    '영어 가사 정렬 모델|C:\\Users\\x\\models\\wav2vec2-english-lyrics',
  ];

  it('matches the correct model per language by folder id in path', () => {
    expect(findModelForLanguage(models, 'ko')).toBe(models[0]);
    expect(findModelForLanguage(models, 'en')).toBe(models[1]);
  });

  it('returns null when the language model is not installed', () => {
    expect(findModelForLanguage([models[0]], 'en')).toBeNull();
    expect(findModelForLanguage(['사용 가능한 모델 없음|none'], 'ko')).toBeNull();
    expect(findModelForLanguage([], 'ko')).toBeNull();
  });

  it('exposes downloadable ids for both languages', () => {
    expect(ALIGNMENT_LANGUAGES.ko.downloadableId).toBe('wav2vec2-korean-lyrics');
    expect(ALIGNMENT_LANGUAGES.en.downloadableId).toBe('wav2vec2-english-lyrics');
  });

  it('rap (dual) mode has no model of its own and expands to ko+en', () => {
    expect(findModelForLanguage(models, 'rap')).toBeNull();
    expect(requiredLanguagesFor('rap')).toEqual(['ko', 'en']);
    expect(requiredLanguagesFor('ko')).toEqual(['ko']);
    expect(requiredLanguagesFor('en')).toEqual(['en']);
  });

  it('accepts rap as a persistable language', () => {
    setAlignmentLanguage('rap');
    expect(getAlignmentLanguage()).toBe('rap');
  });
});

describe('dominantScriptLang', () => {
  it('classifies lines by hangul vs latin letter count', () => {
    expect(dominantScriptLang('난 벨라스케스, 밀레, 엘 fuckin 그레코')).toBe('ko');
    expect(dominantScriptLang("I'm a born hater, Dali, Ban, Picasso")).toBe('en');
    expect(dominantScriptLang('yeah 나쁜 놈들 다 hands up')).toBe('en'); // 라틴 우세
  });

  it('ties and empty text default to ko (safe fallback)', () => {
    expect(dominantScriptLang('')).toBe('ko');
    expect(dominantScriptLang('123 !!')).toBe('ko');
  });
});

describe('mergeDualAlignmentLines (랩/혼합 줄별 병합)', () => {
  it('picks per-line result from the dominant-language model', () => {
    const ko = [
      { text: '난 벨라스케스 밀레', start_ms: 1000, end_ms: 3000 },
      { text: 'I did it my way', start_ms: 3000, end_ms: 5000 }, // ko 모델은 보간값
    ];
    const en = [
      { text: '난 벨라스케스 밀레', start_ms: 900, end_ms: 2800 }, // en 모델은 보간값
      { text: 'I did it my way', start_ms: 4000, end_ms: 6000 },
    ];
    const merged = mergeDualAlignmentLines(ko, en);
    expect(merged[0].start_ms).toBe(1000); // 한국어 줄 → ko 결과
    expect(merged[1].start_ms).toBe(4000); // 영어 줄 → en 결과
  });

  it('repairs monotonicity when mixed passes disagree on ordering', () => {
    const ko = [
      { text: '한국어 줄', start_ms: 10000, end_ms: 12000 },
      { text: 'english line', start_ms: 12000, end_ms: 14000 },
    ];
    const en = [
      { text: '한국어 줄', start_ms: 1000, end_ms: 2000 },
      { text: 'english line', start_ms: 8000, end_ms: 9000 }, // ko 줄(10s)보다 앞
    ];
    const merged = mergeDualAlignmentLines(ko, en);
    expect(merged[0].start_ms).toBe(10000);
    expect(merged[1].start_ms).toBe(10000); // 앞 줄 시작 이후로 클램프
    expect(merged[1].end_ms).toBeGreaterThanOrEqual(merged[1].start_ms + 200);
  });

  it('handles length mismatch by falling back to whichever side exists', () => {
    const ko = [{ text: '가', start_ms: 1000, end_ms: 2000 }];
    const en = [];
    const merged = mergeDualAlignmentLines(ko, en);
    expect(merged).toHaveLength(1);
    expect(merged[0].start_ms).toBe(1000);
  });
});
