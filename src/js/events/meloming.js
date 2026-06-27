/**
 * js/events/meloming.js - Meloming OAuth (header) + songbook settings
 */
import { invoke, listen } from '../tauri-bridge.js';
import { showNotification } from '../utils.js';
import { switchTab } from './navigation.js';

const PLACEHOLDER_AVATAR = './assets/images/app-icon.png';
/** OpenAPI 아티스트·카테고리 생성 API 지원 전까지 동기화 UI 잠금 */
const MELOMING_SYNC_COMING_SOON = true;
const SYNC_COMING_SOON_MSG =
  '노래책 동기화는 업데이트 예정입니다. (멜로밍 OpenAPI 아티스트·카테고리 등록 API 대기 중)';

let pendingOAuthState = null;
let accountMenuOpen = false;

function setStatus(text, isError = false) {
  const el = document.getElementById('meloming-status');
  if (!el) return;
  const firstLine = (text || '').split('\n')[0].trim();
  el.textContent = firstLine;
  el.classList.toggle('is-error', !!isError && !!firstLine);
}

function getAccountElements() {
  return {
    root: document.getElementById('meloming-account'),
    btn: document.getElementById('meloming-account-btn'),
    avatar: document.getElementById('meloming-account-avatar'),
    label: document.getElementById('meloming-account-label'),
    menu: document.getElementById('meloming-account-menu'),
    logout: document.getElementById('meloming-account-logout'),
  };
}

function setAccountMenuOpen(open) {
  const { btn, menu } = getAccountElements();
  accountMenuOpen = open;
  if (menu) menu.hidden = !open;
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function renderGuestAccount() {
  const { btn, avatar, label, menu } = getAccountElements();
  if (!btn || !label) return;

  btn.classList.remove('is-user');
  btn.classList.add('is-guest');
  label.textContent = '멜로밍 로그인';
  if (avatar) {
    avatar.hidden = true;
    avatar.removeAttribute('src');
    avatar.classList.remove('is-placeholder');
  }
  if (menu) menu.hidden = true;
  accountMenuOpen = false;
}

function renderUserAccount(profile) {
  const { btn, avatar, label, menu } = getAccountElements();
  if (!btn || !label) return;

  btn.classList.remove('is-guest');
  btn.classList.add('is-user');
  label.textContent = profile?.nickname || '멜로밍';

  const imageUrl = profile?.profileImageUrl || profile?.profile_image_url;
  if (avatar) {
    avatar.hidden = false;
    if (imageUrl) {
      avatar.src = imageUrl;
      avatar.classList.remove('is-placeholder');
    } else {
      avatar.src = PLACEHOLDER_AVATAR;
      avatar.classList.add('is-placeholder');
    }
  }
  if (menu && !accountMenuOpen) menu.hidden = true;
}

export async function refreshAccountWidget() {
  try {
    const profile = await invoke('meloming_get_user_profile');
    const loggedIn = profile?.loggedIn ?? profile?.logged_in;
    if (loggedIn) {
      renderUserAccount(profile);
    } else {
      renderGuestAccount();
    }
  } catch (err) {
    console.warn('[Meloming] profile refresh failed:', err);
    renderGuestAccount();
  }
}

async function startMelomingLogin(triggerBtn) {
  if (triggerBtn) triggerBtn.disabled = true;
  try {
    const res = await invoke('meloming_oauth_start');
    pendingOAuthState = res?.state || null;
    if (res?.authorizeUrl) {
      console.info('[Meloming OAuth] authorize URL:', res.authorizeUrl);
    }
    showNotification('브라우저에서 멜로밍 로그인을 완료해 주세요.', 'info');
  } catch (err) {
    showNotification(String(err), 'error');
  } finally {
    if (triggerBtn) triggerBtn.disabled = false;
  }
}

async function logoutMeloming() {
  try {
    await invoke('meloming_oauth_logout');
    pendingOAuthState = null;
    setAccountMenuOpen(false);
    await refreshAccountWidget();
    showNotification('멜로밍 로그아웃했습니다.', 'success');
  } catch (err) {
    showNotification(String(err), 'error');
  }
}

function setupAccountWidget() {
  const { btn, logout } = getAccountElements();
  if (!btn) return;

  btn.addEventListener('click', async (event) => {
    event.stopPropagation();
    try {
      const profile = await invoke('meloming_get_user_profile');
      const loggedIn = profile?.loggedIn ?? profile?.logged_in;
      if (!loggedIn) {
        await startMelomingLogin(btn);
        return;
      }
      setAccountMenuOpen(!accountMenuOpen);
    } catch (err) {
      showNotification(String(err), 'error');
    }
  });

  if (logout) {
    logout.addEventListener('click', async (event) => {
      event.stopPropagation();
      await logoutMeloming();
    });
  }

  document.addEventListener('click', (event) => {
    const { root } = getAccountElements();
    if (!root || root.contains(event.target)) return;
    setAccountMenuOpen(false);
  });
}

export async function initMelomingListeners() {
  setupAccountWidget();
  await refreshAccountWidget();

  listen('meloming-oauth-complete', async (event) => {
    const payload = event?.payload || {};
    if (payload.ok) {
      pendingOAuthState = null;
      setAccountMenuOpen(false);
      await refreshAccountWidget();
      showNotification('멜로밍 로그인이 완료되었습니다.', 'success');
    } else {
      const raw = payload.error || '로그인에 실패했습니다.';
      const msg = raw.includes('INTERNAL_ERROR') || raw.includes('서버 내부 오류')
        ? '멜로밍 서버 오류(500)입니다. 잠시 후 다시 로그인해 주세요.'
        : raw;
      showNotification(msg, 'error');
    }
  }).catch(() => {});

  const btnSync = document.getElementById('btn-meloming-sync');

  if (btnSync) {
    btnSync.onclick = async () => {
      if (MELOMING_SYNC_COMING_SOON) {
        setStatus(SYNC_COMING_SOON_MSG);
        showNotification(SYNC_COMING_SOON_MSG, 'info');
        return;
      }
      btnSync.disabled = true;
      setStatus('노래책 동기화 중…');
      try {
        const res = await invoke('meloming_push_songs', { channelId: null });
        let summary = `동기화 완료 — ${res.pushed}곡 (신규 ${res.created}, 갱신 ${res.updated})`;
        if (res.skipped > 0) summary += `, 건너뜀 ${res.skipped}곡`;
        setStatus(summary, res.errors?.length > 0);
        showNotification(summary, res.errors?.length > 0 ? 'warning' : 'success');
        if (res.errors?.length) {
          console.warn(`[Meloming sync] 건너뜀 ${res.skipped}곡 — 사유:`);
          for (const line of res.errors) {
            console.warn(`  · ${line}`);
          }
        }
        await refreshAccountWidget();
        const { loadLibrary } = await import('../audio.js');
        const { state } = await import('../state.js');
        const { renderLibrary } = await import('../ui/library.js');
        state.songLibrary = (await loadLibrary()) || [];
        renderLibrary();
        switchTab('meloming');
      } catch (err) {
        setStatus(String(err), true);
        showNotification(String(err), 'error');
      } finally {
        btnSync.disabled = false;
      }
    };
  }
}
