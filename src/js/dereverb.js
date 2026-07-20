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
      // GPU 가속 팩이 없으면 모델이 있어도 건너뛴다(CPU로는 비현실적으로 느림) —
      // 그 사실을 먼저 알려서 "왜 안 되지" 혼란을 막는다.
      if (!s.installed) {
        st.textContent = '모델 없음 (원본으로 정렬)';
        st.style.color = 'var(--text-muted)';
      } else if (!s.gpuPackInstalled) {
        st.textContent = 'GPU 가속 팩 필요 (원본으로 정렬)';
        st.style.color = '#d9a441';
      } else {
        st.textContent = '모델 설치됨';
        st.style.color = 'var(--accent-primary)';
      }
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
