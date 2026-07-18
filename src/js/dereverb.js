/**
 * 가사 정렬 전용 디리버브 컨트롤 (AI 가사 정렬 섹션).
 * 백엔드: get_dereverb_status / set_dereverb_enabled / open_dereverb_dir.
 */
import { invoke } from './tauri-bridge.js';

async function notify(message, type) {
  try {
    const { showNotification } = await import('./utils.js');
    showNotification(message, type);
  } catch (_) {}
}

export async function refreshDereverbStatus() {
  const chk = document.getElementById('dereverb-enable');
  const st = document.getElementById('dereverb-status');
  if (!chk) return;
  try {
    const s = await invoke('get_dereverb_status');
    chk.checked = s.enabled !== false;
    if (st) {
      st.textContent = s.installed ? '모델 설치됨' : '모델 없음 (원본으로 정렬)';
      st.style.color = s.installed ? 'var(--accent-primary)' : 'var(--text-muted)';
    }
  } catch (_) {}
}

export function initDereverbControls() {
  const chk = document.getElementById('dereverb-enable');
  const openBtn = document.getElementById('dereverb-open-dir');
  if (chk) {
    chk.addEventListener('change', async () => {
      try {
        await invoke('set_dereverb_enabled', { enabled: chk.checked });
      } catch (err) {
        await notify('디리버브 설정 실패: ' + err, 'error');
      }
    });
  }
  if (openBtn) {
    openBtn.addEventListener('click', async () => {
      try {
        await invoke('open_dereverb_dir');
        await refreshDereverbStatus();
      } catch (_) {}
    });
  }
}
