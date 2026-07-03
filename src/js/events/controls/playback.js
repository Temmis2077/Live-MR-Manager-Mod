/**
 * Playback, slider, and seek control listeners
 */
import { state } from '../../state.js';
import { elements } from '../../ui/elements.js';
import { setPitch, setTempo, setMasterVolume, setVocalBalance, seekTo } from '../../audio.js';
import { persistCurrentTrackAudioSettings, setupDirectInput } from './shared.js';

export function initPlaybackListeners() {
  if (elements.togglePlayBtn) {
    elements.togglePlayBtn.onclick = async () => {
      const { handlePlaybackToggle } = await import('../../player.js');
      handlePlaybackToggle();
    };
  }
  if (elements.dockThumb) {
    elements.dockThumb.onclick = async () => {
      const { handlePlaybackToggle } = await import('../../player.js');
      handlePlaybackToggle();
    };
  }

  if (elements.btnPrev) {
    elements.btnPrev.onclick = async () => {
      const { handlePrevTrack } = await import('../../player.js');
      handlePrevTrack();
    };
  }
  if (elements.btnNext) {
    elements.btnNext.onclick = async () => {
      const { handleNextTrack } = await import('../../player.js');
      handleNextTrack();
    };
  }

  if (elements.pitchSlider) {
    elements.pitchSlider.oninput = (e) => {
      const val = Number.parseFloat(e.target.value);
      if (elements.pitchVal) elements.pitchVal.textContent = val > 0 ? `+${val}` : val;
      setPitch(val);
      persistCurrentTrackAudioSettings({ pitch: val });
    };

    elements.pitchSlider.addEventListener("wheel", (e) => {
      e.preventDefault();
      let val = Number.parseFloat(elements.pitchSlider.value);
      const min = Number.parseFloat(elements.pitchSlider.min || "-12");
      const max = Number.parseFloat(elements.pitchSlider.max || "12");
      if (e.deltaY < 0) val += 1; else val -= 1;
      val = Math.max(min, Math.min(max, val));
      elements.pitchSlider.value = String(Math.round(val));
      elements.pitchSlider.dispatchEvent(new Event("input"));
    }, { passive: false });
    elements.pitchSlider.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      elements.pitchSlider.value = "0";
      elements.pitchSlider.dispatchEvent(new Event("input"));
    });

    if (elements.pitchVal) setupDirectInput(elements.pitchVal, elements.pitchSlider);
  }

  if (elements.tempoSlider) {
    elements.tempoSlider.oninput = (e) => {
      const val = parseFloat(e.target.value);
      if (elements.tempoVal) elements.tempoVal.textContent = `${val.toFixed(2)}x`;
      setTempo(val);
      persistCurrentTrackAudioSettings({ tempo: val });
    };

    elements.tempoSlider.addEventListener("wheel", (e) => {
      e.preventDefault();
      let val = parseFloat(elements.tempoSlider.value);
      const min = Number.parseFloat(elements.tempoSlider.min || "0.5");
      const max = Number.parseFloat(elements.tempoSlider.max || "2.0");
      if (e.deltaY < 0) val += 0.05; else val -= 0.05;
      val = Math.max(min, Math.min(max, val));
      elements.tempoSlider.value = val.toFixed(2);
      elements.tempoSlider.dispatchEvent(new Event("input"));
    }, { passive: false });
    elements.tempoSlider.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      elements.tempoSlider.value = "1.00";
      elements.tempoSlider.dispatchEvent(new Event("input"));
    });

    if (elements.tempoVal) setupDirectInput(elements.tempoVal, elements.tempoSlider);
  }

  if (elements.volSlider) {
    elements.volSlider.oninput = (e) => {
      const val = e.target.value;
      if (elements.volSliderVal) elements.volSliderVal.textContent = `${val}%`;
      setMasterVolume(parseFloat(val));
      state.masterVolume = parseFloat(val);
      localStorage.setItem("masterVolume", val);
    };

    elements.volSlider.addEventListener("wheel", (e) => {
      e.preventDefault();
      let val = Number.parseFloat(elements.volSlider.value);
      const min = Number.parseFloat(elements.volSlider.min || "0");
      const max = Number.parseFloat(elements.volSlider.max || "120");
      if (e.deltaY < 0) val += 2; else val -= 2;
      val = Math.max(min, Math.min(max, val));
      elements.volSlider.value = String(Math.round(val));
      elements.volSlider.dispatchEvent(new Event("input"));
    }, { passive: false });
    elements.volSlider.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      elements.volSlider.value = "100";
      elements.volSlider.dispatchEvent(new Event("input"));
    });

    if (elements.volSliderVal) setupDirectInput(elements.volSliderVal, elements.volSlider);
  }

  const labelVocal = document.getElementById("label-vocal-balance");
  const popoverVocal = document.getElementById("popover-vocal-balance");
  const vocalBalanceVal = document.getElementById("vocal-balance-val");

  if (labelVocal && popoverVocal) {
    labelVocal.onclick = (e) => {
      e.stopPropagation();
      if (elements.toggleVocal && elements.toggleVocal.disabled) return;
      popoverVocal.classList.toggle("active");
    };
  }

  if (elements.vocalBalance) {
    elements.vocalBalance.oninput = (e) => {
      const val = e.target.value;
      if (vocalBalanceVal) vocalBalanceVal.textContent = `${val}%`;
      setVocalBalance(parseFloat(val));
    };

    elements.vocalBalance.addEventListener("wheel", (e) => {
      e.preventDefault();
      let val = parseInt(elements.vocalBalance.value);
      if (e.deltaY < 0) val += 5; else val -= 5;
      val = Math.max(0, Math.min(100, val));
      elements.vocalBalance.value = val;
      elements.vocalBalance.dispatchEvent(new Event("input"));
    }, { passive: false });
  }

  if (elements.playbackBar) {
    elements.playbackBar.oninput = (e) => {
      state.isSeeking = true;
      state.currentProgressMs = (parseFloat(e.target.value) / 100) * state.trackDurationMs;
    };
    elements.playbackBar.onchange = async (e) => {
      const { updateThumbnailOverlay } = await import('../../ui/components.js');
      const targetMs = (parseFloat(e.target.value) / 100) * state.trackDurationMs;
      state.targetProgressMs = targetMs;
      state.currentProgressMs = targetMs;
      state.isLoading = true;
      updateThumbnailOverlay();

      try {
        await seekTo(targetMs);
      } catch (err) {
        console.error("Seek failed:", err);
      } finally {
        state.isSeeking = false;
        state.isLoading = false;
        updateThumbnailOverlay();
      }
    };
  }

  const btnReset = document.getElementById("btn-reset-audio");
  if (btnReset) {
    btnReset.onclick = () => {
      if (elements.pitchSlider) {
        elements.pitchSlider.value = 0;
        elements.pitchSlider.dispatchEvent(new Event("input"));
      }
      if (elements.tempoSlider) {
        elements.tempoSlider.value = 1.0;
        elements.tempoSlider.dispatchEvent(new Event("input"));
      }
      import('../../utils.js').then(m => m.showNotification("오디오 설정이 초기화되었습니다.", "info"));
    };
  }
}
