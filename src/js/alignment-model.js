/**
 * alignment-model.js — 정렬 언어 ↔ 설치된 모델 매핑 (에디터·배치 공용)
 *
 * `get_model_list`는 설치된 모델을 `display|경로` 문자열로 반환한다. 경로에는
 * 다운로드 시 쓴 모델 id 폴더명(wav2vec2-korean-lyrics / wav2vec2-english-lyrics)이
 * 들어 있으므로, 그 id로 언어에 맞는 모델을 고른다. "첫 번째 무조건" 방식은
 * 두 모델이 다 설치됐을 때 비결정적이라 이 헬퍼로 대체.
 */

// 언어 코드 → { modelId(다운로드/폴더 식별용), downloadableId(list_downloadable_alignment_models의 id) }
export const ALIGNMENT_LANGUAGES = {
    ko: { modelFolder: 'wav2vec2-korean-lyrics', downloadableId: 'wav2vec2-korean-lyrics', label: '한국어' },
    en: { modelFolder: 'wav2vec2-english-lyrics', downloadableId: 'wav2vec2-english-lyrics', label: 'English' },
};

const LANG_KEY = 'alignmentLanguage';

export function getAlignmentLanguage() {
    const v = localStorage.getItem(LANG_KEY);
    return (v === 'ko' || v === 'en') ? v : 'ko';
}

export function setAlignmentLanguage(lang) {
    if (lang === 'ko' || lang === 'en') localStorage.setItem(LANG_KEY, lang);
}

/** 설치 모델 목록(`get_model_list` 결과: `display|path` 배열)에서 주어진 언어에
 *  해당하는 항목을 찾아 반환. 없으면 null. */
export function findModelForLanguage(models, lang) {
    const spec = ALIGNMENT_LANGUAGES[lang];
    if (!spec) return null;
    const usable = (models || []).filter((m) => !m.endsWith('|none'));
    // 경로(| 뒤)에 모델 폴더명이 포함된 항목을 우선 매칭.
    const matched = usable.find((m) => {
        const path = (m.split('|').pop() || '').replace(/\\/g, '/').toLowerCase();
        return path.includes(spec.modelFolder.toLowerCase());
    });
    return matched || null;
}
