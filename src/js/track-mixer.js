/**
 * 트랙 믹서 (개발용 최소 UI) — 보컬/MR 독립 페이더 + 음소거 + 솔로.
 *
 * 백엔드 set_track_fader / set_track_mute / set_track_solo와 연결. 최종 게인은
 * 볼륨·밸런스·페이더·음소거·솔로를 종합해 백엔드 recompute_mix가 계산한다.
 */
import { invoke } from './tauri-bridge.js';

function setFaderVal(track, pct) {
  const el = document.querySelector(`.track-fader-val[data-track="${track}"]`);
  if (el) el.textContent = `${Math.round(pct)}%`;
}

export async function refreshMixerState() {
  let s;
  try {
    s = await invoke('get_mix_state');
  } catch (err) {
    return; // 오디오 핸들러 미초기화 등 — 조용히 무시
  }
  const map = {
    vocal: { fader: s.vocalFader, muted: s.vocalMuted, solo: s.vocalSolo },
    inst: { fader: s.instFader, muted: s.instMuted, solo: s.instSolo },
  };
  for (const track of ['vocal', 'inst']) {
    const st = map[track];
    const fader = document.querySelector(`.track-fader[data-track="${track}"]`);
    if (fader) fader.value = st.fader;
    setFaderVal(track, st.fader);
    document.querySelector(`.track-mute[data-track="${track}"]`)?.classList.toggle('active', st.muted);
    document.querySelector(`.track-solo[data-track="${track}"]`)?.classList.toggle('active', st.solo);
  }

  // 메트로놈
  const metroFader = document.querySelector('.track-fader[data-track="metro"]');
  if (metroFader) metroFader.value = s.metroGain;
  setFaderVal('metro', s.metroGain);
  document.querySelector('.metro-enable')?.classList.toggle('active', s.metroEnabled);
  const bpmInput = document.getElementById('metro-bpm');
  if (bpmInput) bpmInput.value = Math.round(s.metroBpm);

  // 라우팅 매트릭스
  const routes = {
    'monitor-vocal': s.monRouteVocal, 'monitor-inst': s.monRouteInst, 'monitor-metro': s.monRouteMetro,
    'mr-vocal': s.mrRouteVocal, 'mr-inst': s.mrRouteInst, 'mr-metro': s.mrRouteMetro,
  };
  document.querySelectorAll('.route-cb').forEach((cb) => {
    cb.checked = !!routes[`${cb.dataset.channel}-${cb.dataset.source}`];
  });

  // MR 채널 장치 목록
  const mrSel = document.getElementById('mr-output-device-select');
  if (mrSel) {
    let devices = [];
    try { devices = await invoke('list_output_devices'); } catch (_) {}
    const esc = (x) => String(x).replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const opts = ['<option value="">— MR 채널 끄기 —</option>'];
    for (const d of devices) {
      const label = d.config ? `${d.name} (${d.config})` : d.name;
      const sel = d.name === s.mrDevice ? ' selected' : '';
      opts.push(`<option value="${esc(d.name)}"${sel}>${esc(label)}</option>`);
    }
    mrSel.innerHTML = opts.join('');
    if (!s.mrDevice) mrSel.value = '';
  }
}

// 메트로놈 3개 값(활성/BPM/게인)을 한 번에 백엔드로 보낸다.
async function pushMetronome() {
  const enabled = document.querySelector('.metro-enable')?.classList.contains('active') || false;
  const bpm = parseFloat(document.getElementById('metro-bpm')?.value || '0');
  const gain = parseFloat(document.querySelector('.track-fader[data-track="metro"]')?.value || '80');
  try { await invoke('set_metronome', { enabled, bpm, gain }); } catch (_) {}
}

export function initTrackMixer() {
  document.querySelectorAll('.track-fader').forEach((fader) => {
    fader.addEventListener('input', async () => {
      const track = fader.dataset.track;
      const pct = parseFloat(fader.value);
      setFaderVal(track, pct);
      // 메트로놈 페이더는 set_metronome로(게인만 갱신), 나머지는 set_track_fader.
      if (track === 'metro') { await pushMetronome(); return; }
      try { await invoke('set_track_fader', { track, percent: pct }); } catch (_) {}
    });
  });

  // 메트로놈 켜기/끄기 + BPM
  const metroBtn = document.querySelector('.metro-enable');
  if (metroBtn) {
    metroBtn.addEventListener('click', async () => {
      metroBtn.classList.toggle('active');
      metroBtn.textContent = metroBtn.classList.contains('active') ? '끄기' : '켜기';
      await pushMetronome();
    });
  }
  document.getElementById('metro-bpm')?.addEventListener('change', pushMetronome);

  // 라우팅 체크박스
  document.querySelectorAll('.route-cb').forEach((cb) => {
    cb.addEventListener('change', async () => {
      try {
        await invoke('set_channel_route', { channel: cb.dataset.channel, source: cb.dataset.source, enabled: cb.checked });
      } catch (_) {}
    });
  });

  // MR 채널 출력 장치
  const mrSel = document.getElementById('mr-output-device-select');
  if (mrSel) {
    mrSel.addEventListener('change', async () => {
      mrSel.disabled = true;
      try {
        const resolved = await invoke('set_mr_output_device', { name: mrSel.value });
        await notify(mrSel.value ? `MR 채널: ${resolved}` : 'MR 채널 꺼짐', 'success');
      } catch (err) {
        await notify('MR 채널 설정 실패: ' + err, 'error');
      } finally {
        mrSel.disabled = false;
      }
    });
  }

  document.querySelectorAll('.track-mute').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const track = btn.dataset.track;
      const muted = !btn.classList.contains('active');
      btn.classList.toggle('active', muted);
      try { await invoke('set_track_mute', { track, muted }); } catch (_) {}
    });
  });

  document.querySelectorAll('.track-solo').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const track = btn.dataset.track;
      const soloed = !btn.classList.contains('active');
      btn.classList.toggle('active', soloed);
      try { await invoke('set_track_solo', { track, soloed }); } catch (_) {}
    });
  });
}
