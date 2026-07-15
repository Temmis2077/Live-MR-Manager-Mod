/**
 * js/events/backend.js - Tauri Backend Event Listeners
 */
import { listen } from '../tauri-bridge.js';
import { state } from '../state.js';
import { elements } from '../ui/elements.js';
import { updateTaskUI, updateAiModelStatus, updateCardStatusBadge, updateAiTogglesState } from '../ui/components.js';
import { renderLibrary } from '../ui/library.js';
import { showNotification } from '../utils.js';
import { invoke } from '../tauri-bridge.js';
import { youtubePathsMatch } from '../youtube-utils.js';
let backendListenersInitialized = false;
let taskUiUpdateScheduled = false;

function formatSeparationFailure(statusText) {
  const raw = String(statusText || "").trim();
  if (!raw) return "분리 실패: 원인을 확인할 수 없습니다.";
  if (raw.includes("모델 로딩 시간 초과")) {
    return `${raw}. 잠시 후 재시도하거나 앱 재시작/모델 재다운로드를 권장합니다.`;
  }
  if (raw.includes("모델 초기화 재시도 대기 중")) {
    return `${raw}. 대기 후 다시 시도해 주세요.`;
  }
  if (raw.includes("YouTube 오디오")) {
    return `${raw}. 네트워크 상태 또는 URL 접근 가능 여부를 확인해 주세요.`;
  }
  return `분리 실패: ${raw}`;
}

function pathMatches(a, b) {
  return youtubePathsMatch(a, b);
}

function scheduleTaskUiUpdate() {
  if (taskUiUpdateScheduled) return;
  taskUiUpdateScheduled = true;
  requestAnimationFrame(() => {
    taskUiUpdateScheduled = false;
    updateTaskUI();
  });
}

function persistActiveTasksSnapshot() {
  try {
    const snapshot = {};
    Object.entries(state.activeTasks || {}).forEach(([path, task]) => {
      snapshot[path] = {
        percentage: Number(task?.percentage || 0),
        status: String(task?.status || "Processing"),
        provider: String(task?.provider || "UNKNOWN"),
        model: String(task?.model || "")
      };
    });
    localStorage.setItem(ACTIVE_TASKS_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (_) {}
}

function readActiveTasksSnapshot() {
  try {
    const raw = localStorage.getItem(ACTIVE_TASKS_SNAPSHOT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

export async function setupBackendListeners() {
  if (backendListenersInitialized) return;
  backendListenersInitialized = true;

  // Playback Progress Update
  await listen('playback-progress', (event) => {
    if (!state.isSeeking) {
      // Rust struct may serialize to CamelCase or snake_case depending on serde config.
      const positionMs = event.payload.positionMs ?? event.payload.position_ms ?? 0;
      const durationMs = event.payload.durationMs ?? event.payload.duration_ms ?? 0;

      state.targetProgressMs = positionMs;
      // Ensure duration is always updated if available
      if (durationMs > 0 || !state.trackDurationMs) {
        state.trackDurationMs = durationMs;
      }
    }
  });

  // Playback Status & Auto-Next
  await listen('playback-status', async (event) => {
    const { status, message } = event.payload;
    const s = (status || "").toLowerCase();

    // 1. Loading state
    if (["loading", "downloading", "decoding", "pending"].includes(s)) {
      state.isLoading = true;
    } else {
      state.isLoading = false;
    }

    // 2. Playback state
    if (s === "playing") {
      state.isPlaying = true;
      // Self-heal overlay state sync in case a prior invoke was dropped.
      invoke('update_overlay_state', {
        title: state.currentTrack?.title || "",
        artist: state.currentTrack?.artist || "",
        thumbnail: state.currentTrack?.thumbnail || "",
        isPlaying: true
      }).catch(() => {});
      const { updateProgressBar } = await import('../player.js');
      if (!state.rafId) {
        state.lastRafTime = performance.now();
        state.rafId = requestAnimationFrame(updateProgressBar);
      }
    } else if (["finished", "error", "paused", "stopped"].includes(s)) {
      // Ignore finished/paused during seek to prevent snapback
      if (state.isSeeking && (s === "finished" || s === "paused")) return;

      state.isPlaying = false;
      state.rafId = null;

      if (s === "finished") {
        state.currentProgressMs = 0;
        state.targetProgressMs = 0;

        // Reload track in paused state at 0:00 so it can be replayed
        const { playTrack } = await import('../audio.js');
        await playTrack(state.currentTrack.path, state.trackDurationMs, false);

        // Force UI reset to 0:00
        const { elements } = await import('../ui/elements.js');
        if (elements.playbackBar) elements.playbackBar.value = 0;
        if (elements.progressFill) elements.progressFill.style.width = "0%";
        if (elements.timeCurrent) elements.timeCurrent.textContent = "0:00";

        const { updateThumbnailOverlay, updatePlayButton } = await import('../ui/components.js');
        updateThumbnailOverlay();
        updatePlayButton();
      }
      if (s === "error" && message) {
        showNotification(`재생 오류: ${message}`, "error");
      }

      // Sync overlay state on stop/finish/error
      const { invoke } = await import('../tauri-bridge.js');
      invoke('update_overlay_state', {
        title: state.currentTrack?.title || "",
        artist: state.currentTrack?.artist || "",
        thumbnail: state.currentTrack?.thumbnail || "",
        isPlaying: false
      }).catch(err => console.error("Overlay sync failed:", err));
    }

    // 3. Status Message in Dock (Removed text as per user request)
    const { elements } = await import('../ui/elements.js');
    if (elements.statusMsg) {
      elements.statusMsg.textContent = "";
    }

    const { updateThumbnailOverlay, updatePlayButton } = await import('../ui/components.js');
    updateThumbnailOverlay();
    updatePlayButton();
  });

  // MR Separation Progress (Unified Listener)
  await listen('separation-progress', (event) => {
    const { path, percentage, status, provider, model } = event.payload;
    const s = (status || "").toLowerCase();
    const isFinished = s === "finished";
    const isCancelled = s === "cancelled" || s.includes("cancel");
    const isError = s === "error" || s.startsWith("error:");

    if (isFinished || isCancelled || isError) {
      delete state.activeTasks[path];

      if (isFinished) {
        showNotification("MR 분리가 완료되었습니다.", "success");
        // Update local state flag (exact path + equivalent YouTube URL variants).
        state.songLibrary.forEach((song) => {
          if (!pathMatches(song.path, path)) return;
          song.isSeparated = true;
          song.is_separated = true;
          song.isMr = true;
          song.is_mr = true;
        });
        if (state.currentTrack && pathMatches(state.currentTrack.path, path)) {
          state.currentTrack.isSeparated = true;
          state.currentTrack.is_separated = true;
          state.currentTrack.isMr = true;
          state.currentTrack.is_mr = true;
          updateAiTogglesState(state.currentTrack);
        }
      } else if (isError) {
        showNotification(formatSeparationFailure(status), "error");
      }

      // 노래 추가에서 "분리 후 정렬"로 미뤄둔 곡이면 이제 정렬 대기열에 등록
      // (완료뿐 아니라 오류/취소로 끝나도 — 가사는 저장돼 있고 원본으로도
      // 정렬은 가능하므로 요청을 버리지 않는다).
      import('../alignment-queue.js')
        .then((m) => m.onSeparationTerminated(path, pathMatches))
        .catch(() => {});

      // Refresh library badges for all termination states (finished, cancelled, error)
      renderLibrary();
    } else {
      // Update or Add Task
      state.activeTasks[path] = {
        ...state.activeTasks[path],
        percentage,
        status,
        provider,
        model
      };
    }

    persistActiveTasksSnapshot();
    scheduleTaskUiUpdate();

    // Also update the badge on the library card if it's visible
    updateCardStatusBadge(path);
  });

  // AI Model Status Updates
  await listen('ai_model_status_update', (event) => {
    updateAiModelStatus(event.payload);
  });

  // Model download percentage updates for settings button
  await listen('model-download-progress', (event) => {
    const percentage = Math.round(event.payload);
    if (elements.btnDownloadModel) {
      elements.btnDownloadModel.disabled = true;
      elements.btnDownloadModel.textContent = `다운로드 중 (${percentage}%)`;
      if (percentage >= 100) {
        setTimeout(() => {
          if (elements.btnDownloadModel) {
            elements.btnDownloadModel.disabled = false;
            elements.btnDownloadModel.textContent = "모델 다운로드";
          }
        }, 1500);
      }
    }
  });

  // File Drag & Drop support — 즉시 추가 대신 "노래 추가" 원스톱 모달을
  // 파일이 미리 채워진 상태로 연다(곡 정보/MR 분리/가사 정렬까지 한 번에).
  await listen("tauri://drag-drop", async (event) => {
    const paths = event.payload.paths;
    if (!paths || paths.length === 0) return;
    const audioPaths = paths.filter((path) =>
      ["mp3", "wav", "flac", "m4a", "aac", "ogg", "wma"].includes(path.split('.').pop().toLowerCase())
    );
    if (audioPaths.length === 0) return;
    const { openAddSongModal } = await import('../ui/add-song-modal.js');
    openAddSongModal(audioPaths);
  });

  // Recover active separation queue after frontend reload (F5).
  try {
    const activePaths = await invoke("get_active_separations");
    if (Array.isArray(activePaths)) {
      const snapshot = readActiveTasksSnapshot();
      activePaths.forEach((path) => {
        if (!path) return;
        if (!state.activeTasks[path]) {
          const song = state.songLibrary.find((s) => s.path === path);
          const saved = snapshot[path] || {};
          state.activeTasks[path] = {
            percentage: Number(saved.percentage || 0),
            status: String(saved.status || "Processing"),
            provider: String(saved.provider || "UNKNOWN"),
            model: String(saved.model || ""),
            title: song?.title || "알 수 없는 곡",
            thumbnail: song?.thumbnail || ""
          };
        }
      });
      if (activePaths.length > 0) {
        persistActiveTasksSnapshot();
        scheduleTaskUiUpdate();
        activePaths.forEach((path) => updateCardStatusBadge(path));
      }
    }
  } catch (err) {
    console.warn("[Backend] Failed to recover active separation queue:", err);
  }
}
