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
});
