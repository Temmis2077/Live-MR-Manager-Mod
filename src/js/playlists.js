/**
 * playlists.js — 플레이리스트 프론트엔드 (스포티파이 스타일)
 *
 * 두 진입점:
 *  1. 곡 우클릭 → "플레이리스트에 추가" → 소형 팝업(기존 플리 목록 + 새로
 *     만들기). openAddToPlaylistPopup(song, x, y)
 *  2. 사이드바 플레이리스트 탭 → 플리 목록 ↔ 선택한 플리의 곡 목록.
 *     renderPlaylistsPage() (navigation.js의 switchTab('playlists')가 호출)
 *
 * 저장은 전부 백엔드 SQLite(playlists.rs) — 프론트는 캐시 없이 매번 조회
 * (플리 개수·곡 수가 작아 충분히 싸다).
 */
import { invoke } from './tauri-bridge.js';
import { state } from './state.js';
import { showNotification, getThumbnailUrl } from './utils.js';
import { filterByPlaylist } from './library-filters.js';

// ── 우클릭 "플레이리스트에 추가" 팝업 ─────────────────────────────────

let popupEl = null;

function closeAddPopup() {
    if (popupEl) {
        popupEl.remove();
        popupEl = null;
        document.removeEventListener('click', onOutsideClick, true);
    }
}

function onOutsideClick(e) {
    if (popupEl && !popupEl.contains(e.target)) closeAddPopup();
}

/** 곡 우클릭 메뉴에서 호출 — (x,y) 근처에 플리 선택 팝업을 띄운다. */
export async function openAddToPlaylistPopup(song, x, y) {
    closeAddPopup();
    let playlists = [];
    try {
        playlists = await invoke('get_playlists');
    } catch (err) {
        console.error('[Playlists] get_playlists failed:', err);
        showNotification('플레이리스트 목록을 불러오지 못했습니다: ' + err, 'error');
        return;
    }

    popupEl = document.createElement('div');
    popupEl.className = 'playlist-popup';
    popupEl.innerHTML = `
        <div class="playlist-popup-title">플레이리스트에 추가</div>
        ${playlists.map((p) => `
            <div class="playlist-popup-item" data-id="${p.id}">
                <span class="playlist-popup-name"></span>
                <span class="playlist-popup-count">${p.track_count}곡</span>
            </div>
        `).join('')}
        ${playlists.length === 0 ? '<div class="playlist-popup-empty">아직 플레이리스트가 없습니다</div>' : ''}
        <div class="playlist-popup-item playlist-popup-new" data-id="new">＋ 새 플레이리스트</div>
    `;
    // 이름은 textContent로 넣어 XSS/마크업 파손 방지
    popupEl.querySelectorAll('.playlist-popup-item[data-id]:not([data-id="new"])').forEach((el, i) => {
        el.querySelector('.playlist-popup-name').textContent = playlists[i].name;
    });

    document.body.appendChild(popupEl);
    // 화면 경계 이탈 방지
    const rect = popupEl.getBoundingClientRect();
    popupEl.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
    popupEl.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;

    popupEl.addEventListener('click', async (e) => {
        const item = e.target.closest('.playlist-popup-item');
        if (!item) return;
        const id = item.dataset.id;
        try {
            let playlistId;
            let playlistName;
            if (id === 'new') {
                const name = await promptPlaylistName('새 플레이리스트');
                if (!name) { closeAddPopup(); return; }
                playlistId = await invoke('create_playlist', { name });
                playlistName = name;
            } else {
                playlistId = parseInt(id, 10);
                playlistName = playlists.find((p) => p.id === playlistId)?.name || '플레이리스트';
            }
            await invoke('add_track_to_playlist', { playlistId, path: song.path });
            showNotification(`「${song.title || '곡'}」을(를) "${playlistName}"에 추가했습니다.`, 'success');
        } catch (err) {
            console.error('[Playlists] add failed:', err);
            showNotification('플레이리스트에 추가하지 못했습니다: ' + err, 'error');
        }
        closeAddPopup();
    });

    setTimeout(() => document.addEventListener('click', onOutsideClick, true), 0);
}

/** 이름 입력 소형 모달 — 확인 시 이름 문자열, 취소 시 null. */
function promptPlaylistName(defaultValue = '') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.style.zIndex = '10050';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 340px; padding: 20px;">
                <h3 style="margin: 0 0 12px;">플레이리스트 이름</h3>
                <input type="text" id="playlist-name-input" class="playlist-name-input" spellcheck="false">
                <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
                    <button type="button" class="sync-reset-btn" data-act="cancel">취소</button>
                    <button type="button" class="sync-reset-btn" data-act="ok" style="color:var(--accent-primary);">만들기</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('#playlist-name-input');
        input.value = defaultValue;
        input.focus();
        input.select();

        const finish = (val) => { overlay.remove(); resolve(val); };
        overlay.querySelector('[data-act="ok"]').onclick = () => finish(input.value.trim() || null);
        overlay.querySelector('[data-act="cancel"]').onclick = () => finish(null);
        input.onkeydown = (e) => {
            if (e.key === 'Enter') finish(input.value.trim() || null);
            if (e.key === 'Escape') finish(null);
        };
        overlay.onclick = (e) => { if (e.target === overlay) finish(null); };
    });
}

// ── 플레이리스트 페이지 (사이드바 탭) ────────────────────────────────

// 현재 열어둔 플리 id (null = 목록 화면)
let openPlaylistId = null;

export async function renderPlaylistsPage() {
    const container = document.getElementById('playlists-container');
    if (!container) return;
    if (openPlaylistId != null) {
        await renderPlaylistDetail(container, openPlaylistId);
    } else {
        await renderPlaylistIndex(container);
    }
}

async function renderPlaylistIndex(container) {
    let playlists = [];
    try {
        playlists = await invoke('get_playlists');
    } catch (err) {
        container.innerHTML = '<div class="no-tasks">플레이리스트를 불러오지 못했습니다.</div>';
        return;
    }

    container.innerHTML = `
        <div class="playlist-index-header">
            <button type="button" class="sync-reset-btn" id="playlist-create-btn" style="color:var(--accent-primary);">＋ 새 플레이리스트</button>
        </div>
        <div class="playlist-index-list">
            ${playlists.length === 0 ? '<div class="no-tasks">플레이리스트가 없습니다. 곡을 우클릭해 "플레이리스트에 추가"로 시작해보세요.</div>' : ''}
            ${playlists.map((p) => `
                <div class="playlist-card" data-id="${p.id}">
                    <div class="playlist-card-icon">♪</div>
                    <div class="playlist-card-body">
                        <div class="playlist-card-name"></div>
                        <div class="playlist-card-count">${p.track_count}곡</div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    container.querySelectorAll('.playlist-card').forEach((el, i) => {
        el.querySelector('.playlist-card-name').textContent = playlists[i].name;
        el.onclick = () => { openPlaylistId = playlists[i].id; renderPlaylistsPage(); };
    });
    const createBtn = container.querySelector('#playlist-create-btn');
    if (createBtn) {
        createBtn.onclick = async () => {
            const name = await promptPlaylistName('새 플레이리스트');
            if (!name) return;
            try {
                await invoke('create_playlist', { name });
                renderPlaylistsPage();
            } catch (err) {
                showNotification('플레이리스트 생성 실패: ' + err, 'error');
            }
        };
    }
}

async function renderPlaylistDetail(container, playlistId) {
    let playlists = [];
    let paths = [];
    try {
        [playlists, paths] = await Promise.all([
            invoke('get_playlists'),
            invoke('get_playlist_track_paths', { playlistId }),
        ]);
    } catch (err) {
        container.innerHTML = '<div class="no-tasks">플레이리스트를 불러오지 못했습니다.</div>';
        return;
    }
    const info = playlists.find((p) => p.id === playlistId);
    if (!info) { openPlaylistId = null; return renderPlaylistIndex(container); }

    const songs = filterByPlaylist(state.songLibrary, paths);

    container.innerHTML = `
        <div class="playlist-detail-header">
            <button type="button" class="sync-reset-btn" id="playlist-back-btn">← 목록</button>
            <h2 class="playlist-detail-name"></h2>
            <span class="playlist-card-count">${songs.length}곡</span>
            <span class="marker-row-spacer" style="flex:1;"></span>
            <button type="button" class="sync-reset-btn" id="playlist-rename-btn">이름 변경</button>
            <button type="button" class="sync-reset-btn" id="playlist-delete-btn" style="color:#ef4444;">플리 삭제</button>
        </div>
        <div class="playlist-track-list">
            ${songs.length === 0 ? '<div class="no-tasks">이 플레이리스트에 곡이 없습니다.</div>' : ''}
            ${songs.map((s, i) => `
                <div class="playlist-track-row" data-path="${encodeURIComponent(s.path)}">
                    <span class="marker-num">${i + 1}</span>
                    <img class="playlist-track-thumb" src="${getThumbnailUrl(s.thumbnail) || ''}" onerror="this.style.visibility='hidden'">
                    <div class="playlist-track-meta">
                        <div class="playlist-track-title"></div>
                        <div class="playlist-track-artist"></div>
                    </div>
                    <button type="button" class="sync-reset-btn playlist-track-play" title="재생">▶</button>
                    <button type="button" class="marker-delete-btn playlist-track-remove" title="플레이리스트에서 제거">×</button>
                </div>
            `).join('')}
        </div>
    `;
    container.querySelector('.playlist-detail-name').textContent = info.name;
    container.querySelectorAll('.playlist-track-row').forEach((row, i) => {
        row.querySelector('.playlist-track-title').textContent = songs[i].title || songs[i].path;
        row.querySelector('.playlist-track-artist').textContent = songs[i].artist || '';
        row.querySelector('.playlist-track-play').onclick = async () => {
            const idx = state.songLibrary.findIndex((s) => s.path === songs[i].path);
            if (idx === -1) return;
            const { selectTrack } = await import('./player.js');
            selectTrack(idx);
        };
        row.querySelector('.playlist-track-remove').onclick = async () => {
            try {
                await invoke('remove_track_from_playlist', { playlistId, path: songs[i].path });
                renderPlaylistsPage();
            } catch (err) {
                showNotification('제거 실패: ' + err, 'error');
            }
        };
    });

    container.querySelector('#playlist-back-btn').onclick = () => { openPlaylistId = null; renderPlaylistsPage(); };
    container.querySelector('#playlist-rename-btn').onclick = async () => {
        const name = await promptPlaylistName(info.name);
        if (!name || name === info.name) return;
        try {
            await invoke('rename_playlist', { playlistId, name });
            renderPlaylistsPage();
        } catch (err) {
            showNotification('이름 변경 실패: ' + err, 'error');
        }
    };
    container.querySelector('#playlist-delete-btn').onclick = async () => {
        if (!confirm(`"${info.name}" 플레이리스트를 삭제하시겠습니까? (곡 자체는 삭제되지 않습니다)`)) return;
        try {
            await invoke('delete_playlist', { playlistId });
            openPlaylistId = null;
            renderPlaylistsPage();
        } catch (err) {
            showNotification('플레이리스트 삭제 실패: ' + err, 'error');
        }
    };
}
