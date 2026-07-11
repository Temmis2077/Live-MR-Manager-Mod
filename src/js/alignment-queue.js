/**
 * alignment-queue.js — AI 가사 정렬 배치 대기열 (헤드리스 순차 처리기)
 *
 * 라이브러리에서 여러 곡을 선택해 일괄 정렬을 요청하면, 여기서 한 곡씩
 * 순서대로 처리한다: LRC 로드 → 미싱크 가사 추출 → run_forced_alignment →
 * 결과 병합(mergeAlignmentResult, 에디터와 동일 규칙) → LRC 저장.
 *
 * 반드시 엄격한 순차 처리여야 한다 — 백엔드의 `alignment-progress` 이벤트에는
 * 곡 식별자가 없어서, "지금 processing인 항목이 곧 이 이벤트의 주인"이라는
 * 가정으로 진행률을 귀속시키기 때문. (백엔드 쪽도 ALIGNMENT_QUEUE_LOCK으로
 * 직렬화되므로, 에디터의 단발 정렬 버튼과 겹쳐도 상태가 꼬이지 않는다.)
 */
import { invoke, listen } from './tauri-bridge.js';
import { state } from './state.js';
import { parseLrc, mergeAlignmentResult, getSyncText, isTriplet } from './lrc-parser.js';

let isRunning = false;
let listenerReady = false;

function notifyQueueChanged() {
    import('./ui/components.js').then((m) => {
        if (m.updateTaskUI) m.updateTaskUI();
    }).catch(() => {});
}

function currentProcessingItem() {
    return state.alignmentQueue.find((item) => item.status === 'processing') || null;
}

async function ensureProgressListener() {
    if (listenerReady) return;
    listenerReady = true;
    await listen('alignment-progress', (event) => {
        const item = currentProcessingItem();
        if (!item) return; // 에디터의 단발 정렬 진행률 — 대기열 소관 아님
        const p = Number(event.payload);
        if (p === -1) {
            // 백엔드 락 대기 센티널 — 이미 '대기 중' 표시라 그대로 둠
            return;
        }
        if (Number.isFinite(p)) {
            item.percentage = Math.max(0, Math.min(100, p));
            notifyQueueChanged();
        }
    });
}

/** 정렬 가능한 모델 해석 — 에디터(runAiAlignment)와 동일 규칙. 배치 중에는
 *  다운로드 프롬프트를 띄우지 않고, 모델이 없으면 null을 반환한다. */
async function resolveAlignmentModel() {
    let models = [];
    try {
        models = await invoke('get_model_list');
    } catch (err) {
        console.error('[AlignQueue] get_model_list failed:', err);
        return null;
    }
    const usable = (models || []).filter((m) => !m.endsWith('|none'));
    return usable.length > 0 ? usable[0] : null;
}

/** LRC 세그먼트를 다시 LRC 텍스트로 인코딩 (에디터 saveLrc()의 가사 줄 부분과
 *  동일 포맷 — 마커는 배치 경로에서 손대지 않으므로 원본에서 그대로 보존). */
function encodeSegmentsToLrc(segments, preservedMarkerLines) {
    const entries = [];
    segments.forEach((s) => {
        const min = Math.floor(s.start / 60).toString().padStart(2, '0');
        const sec = (s.start % 60).toFixed(2).padStart(5, '0');
        const ts = `[${min}:${sec}]`;
        if (isTriplet(s)) {
            entries.push({ time: s.start, line: `${ts}[orig]${s.original || ''}` });
            entries.push({ time: s.start, line: `${ts}[pron]${s.pronunciation || ''}` });
            entries.push({ time: s.start, line: `${ts}[tran]${s.translation || ''}` });
        } else if ((s.text || '').trim()) {
            entries.push({ time: s.start, line: `${ts}${s.text}` });
        }
    });
    (preservedMarkerLines || []).forEach((m) => entries.push(m));
    entries.sort((a, b) => a.time - b.time);
    return entries.map((e) => e.line).join('\n');
}

/** 원본 LRC에서 마커 줄([vocalstart]/[ilstart]/[ilend])만 추려 보존용으로 반환. */
function extractMarkerLines(lrcContent) {
    const markerRegex = /^\[(\d{2}):(\d{2}\.\d{2,3})\]\[(vocalstart|ilstart|ilend)\]\s*$/;
    const lines = (lrcContent || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    lines.forEach((line) => {
        const m = markerRegex.exec(line.trim());
        if (m) {
            const time = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
            out.push({ time, line: line.trim() });
        }
    });
    return out;
}

async function processOne(item) {
    // 1. LRC 로드 + 파싱
    let lrcContent = '';
    try {
        lrcContent = await invoke('load_lrc_file', { audioPath: item.path });
    } catch (err) {
        // 파일 없음 — 가사 자체가 없는 곡
    }
    if (!lrcContent || !lrcContent.trim()) {
        item.status = 'no-lyrics';
        return;
    }
    const segments = parseLrc(lrcContent, 0);
    // 에디터(runAiAlignment)와 동일하게 "전체" 가사를 정렬 입력으로 보낸다
    // (문맥이 온전해야 CTC 정렬 정확도가 높음) — 병합은 미싱크 줄에만 됨.
    const allTexts = segments
        .map((s) => getSyncText(s).trim())
        .filter((t) => t.length > 0);
    const hasUnsynced = segments.some(
        (s) => s.start === 0 && s.end === 0 && getSyncText(s).trim().length > 0
    );
    if (allTexts.length === 0) {
        item.status = 'no-lyrics';
        return;
    }
    if (!hasUnsynced) {
        // 가사는 있지만 전부 이미 싱크됨 — 할 일 없음, 완료 처리
        item.status = 'done';
        item.note = '이미 싱크됨';
        return;
    }

    // 2. 모델 확인 (없으면 이 항목만 실패 — 배치 중 다운로드 프롬프트 없음)
    const model = await resolveAlignmentModel();
    if (!model) {
        item.status = 'error';
        item.error = '정렬 모델이 설치되어 있지 않습니다 (가사 싱크 탭에서 먼저 다운로드하세요).';
        return;
    }

    // 3. 강제정렬 실행 (백엔드 락이 에디터 단발 실행과의 동시성도 직렬화)
    const result = await invoke('run_forced_alignment', {
        audioPath: item.path,
        lyrics: allTexts.join('\n'),
        modelName: model,
        language: 'ko',
    });

    const lines = (result && result.lines) || [];
    const appliedCount = mergeAlignmentResult(segments, lines);
    if (appliedCount === 0) {
        item.status = 'error';
        item.error = 'AI가 정렬한 줄과 일치하는 미싱크 가사를 찾지 못했습니다.';
        return;
    }

    // 4. 저장 (마커 줄 보존)
    const content = encodeSegmentsToLrc(segments, extractMarkerLines(lrcContent));
    await invoke('save_lrc_file', { audioPath: item.path, content });

    // 라이브러리 카드의 가사 보유 표시 즉시 갱신
    const song = state.songLibrary.find((s) => s.path === item.path);
    if (song) { song.hasLyrics = true; song.has_lyrics = true; }

    item.status = 'done';
    item.note = `${appliedCount}줄 배치됨`;
}

async function runQueue() {
    if (isRunning) return;
    isRunning = true;
    await ensureProgressListener();
    try {
        for (;;) {
            const item = state.alignmentQueue.find((i) => i.status === 'queued');
            if (!item) break;
            item.status = 'processing';
            item.percentage = 0;
            notifyQueueChanged();
            try {
                await processOne(item);
            } catch (err) {
                const msg = String(err);
                if (msg.includes('취소')) {
                    item.status = 'cancelled';
                } else {
                    console.error('[AlignQueue] item failed:', item.path, err);
                    item.status = 'error';
                    item.error = msg;
                }
            }
            notifyQueueChanged();
        }
    } finally {
        isRunning = false;
    }
}

/** 여러 곡을 정렬 대기열에 추가하고 (미실행 중이면) 순차 처리를 시작한다. */
export function enqueueAlignment(paths) {
    const active = new Set(
        state.alignmentQueue
            .filter((i) => i.status === 'queued' || i.status === 'processing')
            .map((i) => i.path)
    );
    let added = 0;
    (paths || []).forEach((path) => {
        if (!path || active.has(path)) return;
        // 같은 곡의 지난 실행 결과(done/error 등)가 남아있으면 치우고 다시
        // 등록 — 렌더러가 path를 카드 키로 쓰므로 경로 중복은 허용하지 않음.
        const staleIdx = state.alignmentQueue.findIndex((i) => i.path === path);
        if (staleIdx !== -1) state.alignmentQueue.splice(staleIdx, 1);
        const song = state.songLibrary.find((s) => s.path === path);
        state.alignmentQueue.push({
            path,
            title: song?.title || path,
            thumbnail: song?.thumbnail || '',
            status: 'queued',
        });
        active.add(path);
        added++;
    });
    if (added > 0) {
        notifyQueueChanged();
        runQueue();
    }
    return added;
}

/**
 * 가사 싱크 탭(에디터)의 단발 "AI 자동 정렬" 실행을 대기열 UI에 표시하기
 * 위한 훅. 배치 대기열(runQueue)이 처리하는 항목이 아니라(상태가 바로
 * 'processing'이라 runQueue의 'queued' 스캔에 안 걸림) 표시 전용 항목이며,
 * 진행률은 기존 alignment-progress 리스너가 'processing' 항목에 귀속시키는
 * 로직을 그대로 탄다. 반환된 finish(status, extra)로 종료 상태를 기록한다.
 */
export async function beginExternalAlignment(path) {
    await ensureProgressListener();
    const staleIdx = state.alignmentQueue.findIndex((i) => i.path === path && i.status !== 'processing');
    if (staleIdx !== -1) state.alignmentQueue.splice(staleIdx, 1);
    const song = state.songLibrary.find((s) => s.path === path);
    const item = {
        path,
        title: song?.title || path,
        thumbnail: song?.thumbnail || '',
        status: 'processing',
        percentage: 0,
        external: true,
    };
    state.alignmentQueue.push(item);
    notifyQueueChanged();
    return (status, extra = {}) => {
        item.status = status;
        Object.assign(item, extra);
        notifyQueueChanged();
    };
}

/** 대기열 항목 취소/제거. queued는 즉시 제거(백엔드 호출 없음), processing은
 *  전역 취소 커맨드 호출(활성 정렬은 항상 1개라 안전). done/error 등 완료
 *  상태는 목록에서 치우는 용도. */
export async function cancelAlignmentQueueItem(path) {
    const idx = state.alignmentQueue.findIndex((i) => i.path === path);
    if (idx === -1) return;
    const item = state.alignmentQueue[idx];
    if (item.status === 'processing') {
        try {
            await invoke('cancel_forced_alignment');
        } catch (err) {
            console.error('[AlignQueue] cancel failed:', err);
        }
        // 실제 상태 전환은 runQueue의 에러 처리(취소 메시지)에서 일어남
    } else {
        state.alignmentQueue.splice(idx, 1);
        notifyQueueChanged();
    }
}
