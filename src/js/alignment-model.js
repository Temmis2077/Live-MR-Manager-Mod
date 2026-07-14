/**
 * alignment-model.js — 정렬 언어 ↔ 설치된 모델 매핑 (에디터·배치 공용)
 *
 * `get_model_list`는 설치된 모델을 `display|경로` 문자열로 반환한다. 경로에는
 * 다운로드 시 쓴 모델 id 폴더명(wav2vec2-korean-lyrics / wav2vec2-english-lyrics)이
 * 들어 있으므로, 그 id로 언어에 맞는 모델을 고른다. "첫 번째 무조건" 방식은
 * 두 모델이 다 설치됐을 때 비결정적이라 이 헬퍼로 대체.
 *
 * '랩/혼합(rap)'은 단일 모델이 아니라 한국어+영어 두 모델을 순차로 돌린 뒤
 * 줄마다 우세 언어(한글/라틴 글자 비율) 결과를 채택하는 듀얼 모드다 —
 * 힙합처럼 한 곡에 한국어 줄과 영어 줄이 섞인 가사를 위해.
 */

// 언어 코드 → { modelId(다운로드/폴더 식별용), downloadableId(list_downloadable_alignment_models의 id) }
export const ALIGNMENT_LANGUAGES = {
    ko: { modelFolder: 'wav2vec2-korean-lyrics', downloadableId: 'wav2vec2-korean-lyrics', label: '한국어' },
    en: { modelFolder: 'wav2vec2-english-lyrics', downloadableId: 'wav2vec2-english-lyrics', label: 'English' },
    rap: { label: '랩/혼합 (한+영)' }, // 듀얼 모드 — 자체 모델 없음, ko+en 둘 다 필요
};

const LANG_KEY = 'alignmentLanguage';

export function getAlignmentLanguage() {
    const v = localStorage.getItem(LANG_KEY);
    return ALIGNMENT_LANGUAGES[v] ? v : 'ko';
}

export function setAlignmentLanguage(lang) {
    if (ALIGNMENT_LANGUAGES[lang]) localStorage.setItem(LANG_KEY, lang);
}

/** 이 언어 설정으로 정렬하려면 실제로 필요한 (단일 모델) 언어 목록. */
export function requiredLanguagesFor(lang) {
    return lang === 'rap' ? ['ko', 'en'] : [lang];
}

/** 설치 모델 목록(`get_model_list` 결과: `display|path` 배열)에서 주어진 언어에
 *  해당하는 항목을 찾아 반환. 없으면 null. (rap 같은 듀얼 모드는 자체 모델이
 *  없으므로 null — requiredLanguagesFor로 풀어서 개별 조회할 것.) */
export function findModelForLanguage(models, lang) {
    const spec = ALIGNMENT_LANGUAGES[lang];
    if (!spec || !spec.modelFolder) return null;
    const usable = (models || []).filter((m) => !m.endsWith('|none'));
    // 경로(| 뒤)에 모델 폴더명이 포함된 항목을 우선 매칭.
    const matched = usable.find((m) => {
        const path = (m.split('|').pop() || '').replace(/\\/g, '/').toLowerCase();
        return path.includes(spec.modelFolder.toLowerCase());
    });
    return matched || null;
}

/** 한 줄 가사의 우세 스크립트 판정: 한글 글자 수 vs 라틴 글자 수.
 *  동률(비어있음 포함)은 'ko' — 한국어 모델도 라틴 단어를 보간 처리하므로
 *  안전한 기본값. */
export function dominantScriptLang(text) {
    let hangul = 0;
    let latin = 0;
    for (const c of text || '') {
        const cp = c.codePointAt(0);
        if ((cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x3131 && cp <= 0x318e)) hangul++;
        else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin++;
    }
    return latin > hangul ? 'en' : 'ko';
}

/**
 * 듀얼(한국어+영어) 정렬 결과를 줄 단위로 병합한다.
 *
 * 두 결과는 같은 가사 입력에서 나오므로 줄 순서·개수가 같다(인덱스 병합).
 * 줄마다 우세 스크립트 언어의 결과를 채택 — 한국어 줄은 한국어 모델이,
 * 영어 줄은 영어 모델이 실제 음향과 정렬한 시각이라 정확하다(반대 모델은
 * 그 줄을 보간만 함). 서로 다른 Viterbi 경로에서 온 시각이 섞이므로 마지막에
 * 시간 단조성을 보정한다(앞줄 시작보다 뒤로 가지 않게 클램프).
 *
 * @param koLines 한국어 모델 결과 lines ({text, start_ms, end_ms})
 * @param enLines 영어 모델 결과 lines
 * @returns 병합된 lines (길이가 다르면 긴 쪽 기준, 없는 쪽은 있는 쪽 사용)
 */
export function mergeDualAlignmentLines(koLines, enLines) {
    const ko = Array.isArray(koLines) ? koLines : [];
    const en = Array.isArray(enLines) ? enLines : [];
    const n = Math.max(ko.length, en.length);
    const merged = [];
    for (let i = 0; i < n; i++) {
        const k = ko[i];
        const e = en[i];
        let pick;
        if (k && e) {
            pick = dominantScriptLang((k.text || e.text || '')) === 'en' ? e : k;
        } else {
            pick = k || e;
        }
        merged.push({ ...pick });
    }
    // 시간 단조성 보정: 두 독립 경로의 시각이 섞여 순서가 뒤집힌 줄은
    // 앞 줄 시작 이후로 밀고 최소 길이(0.2s)를 보장한다.
    let prevStart = -Infinity;
    merged.forEach((line) => {
        if (typeof line.start_ms !== 'number') return;
        if (line.start_ms < prevStart) line.start_ms = prevStart;
        if (typeof line.end_ms !== 'number' || line.end_ms < line.start_ms + 200) {
            line.end_ms = line.start_ms + 200;
        }
        prevStart = line.start_ms;
    });
    return merged;
}
