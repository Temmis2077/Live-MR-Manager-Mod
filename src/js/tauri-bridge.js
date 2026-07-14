/**
 * tauri-bridge.js
 * 
 * Provides a safe abstraction layer between the frontend and Tauri APIs.
 * When running in a standard browser environment, it provides Mocks to prevent crashes.
 */

const isTauri = !!window.__TAURI__;

// 브라우저(목) 모드 전용 플레이리스트 인메모리 저장소 — 실제 앱은 SQLite 사용.
const mockPlaylists = [];
let mockPlaylistSeq = 0;

if (!isTauri) {
  console.warn("[Tauri-Bridge] window.__TAURI__ is not defined. Running in Browser/Mock mode.");
}

/**
 * Safe invoke wrapper
 */
export async function invoke(command, args = {}) {
  if (isTauri) {
    return await window.__TAURI__.core.invoke(command, args);
  }
  
  console.log(`[Mock-Invoke] ${command}`, args);

  // Provide mock responses for common initialization calls
  switch (command) {
    case 'load_library':
      return [];
    // 플레이리스트 — 브라우저 모드에서 UI 흐름을 시험할 수 있게 인메모리 목 제공
    case 'get_playlists':
      return mockPlaylists.map((p) => ({ id: p.id, name: p.name, track_count: p.tracks.length }));
    case 'create_playlist': {
      const id = ++mockPlaylistSeq;
      mockPlaylists.push({ id, name: args.name, tracks: [] });
      return id;
    }
    case 'rename_playlist': {
      const p = mockPlaylists.find((x) => x.id === args.playlistId);
      if (p) p.name = args.name;
      return;
    }
    case 'delete_playlist': {
      const i = mockPlaylists.findIndex((x) => x.id === args.playlistId);
      if (i !== -1) mockPlaylists.splice(i, 1);
      return;
    }
    case 'add_track_to_playlist': {
      const p = mockPlaylists.find((x) => x.id === args.playlistId);
      if (p && !p.tracks.includes(args.path)) p.tracks.push(args.path);
      return;
    }
    case 'remove_track_from_playlist': {
      const p = mockPlaylists.find((x) => x.id === args.playlistId);
      if (p) p.tracks = p.tracks.filter((t) => t !== args.path);
      return;
    }
    case 'get_playlist_track_paths':
      return (mockPlaylists.find((x) => x.id === args.playlistId)?.tracks || []).slice();
    case 'check_model_ready':
      return false;
    case 'get_gpu_recommendation':
      return { recommendation: "Browser Mock", gpu: "None" };
    case 'set_master_volume':
    case 'set_volume':
      return;
    case 'analyze_key_bpm':
      return { key: 'C', bpm: 120 };
    default:
      return null;
  }
}

/**
 * Safe event listener wrapper
 */
export async function listen(event, handler) {
  if (isTauri) {
    return await window.__TAURI__.event.listen(event, handler);
  }
  
  console.log(`[Mock-Listen] Subscribed to: ${event}`);
  return () => console.log(`[Mock-Unlisten] ${event}`);
}

/**
 * Safe window object
 */
export const appWindow = isTauri ? window.__TAURI__.window.getCurrentWindow() : {
  minimize: async () => console.log("[Mock-Window] Minimize"),
  maximize: async () => console.log("[Mock-Window] Maximize"),
  unmaximize: async () => console.log("[Mock-Window] Unmaximize"),
  isMaximized: async () => false,
  toggleMaximize: async () => console.log("[Mock-Window] Toggle Maximize"),
  close: async () => console.log("[Mock-Window] Close"),
  startDragging: async () => console.log("[Mock-Window] Start Dragging"),
  isVisible: async () => false,
  hide: async () => {},
  show: async () => {},
  setFocus: async () => {}
};

export async function toggleWindowMaximize() {
  if (!isTauri) {
    console.log("[Mock-Window] Toggle Maximize");
    return;
  }

  try {
    const maximized = await appWindow.isMaximized();
    if (maximized) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
  } catch (error) {
    console.warn("[Window] maximize/unmaximize failed, falling back to toggleMaximize:", error);
    await appWindow.toggleMaximize();
  }
}

/**
 * Safe emit wrapper
 */
export async function emit(event, payload) {
  if (isTauri) {
    return await window.__TAURI__.event.emit(event, payload);
  }
  console.log(`[Mock-Emit] ${event}`, payload);
}

export class WebviewWindow {
  constructor(label, options) {
    if (isTauri) {
      return new window.__TAURI__.webviewWindow.WebviewWindow(label, options);
    }
    console.log(`[Mock-WebviewWindow] Created: ${label}`, options);
  }
}

export async function getAllWindows() {
  if (isTauri) return await window.__TAURI__.window.getAllWindows();
  return [appWindow];
}

/**
 * Safe convertFileSrc wrapper
 */
export function convertFileSrc(path, protocol = 'asset') {
  if (isTauri) {
    return window.__TAURI__.core.convertFileSrc(path, protocol);
  }
  return path; // Fallback to raw path in browser
}
