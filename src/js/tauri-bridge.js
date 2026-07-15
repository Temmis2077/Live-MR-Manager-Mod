/**
 * tauri-bridge.js
 * 
 * Provides a safe abstraction layer between the frontend and Tauri APIs.
 * When running in a standard browser environment, it provides Mocks to prevent crashes.
 */

const isTauri = !!window.__TAURI__;

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
    case 'check_model_ready':
      return false;
    case 'get_gpu_recommendation':
      return { recommendation: "Browser Mock", gpu: "None" };
    case 'set_master_volume':
    case 'set_volume':
      return;
    case 'analyze_key_bpm':
      return { key: 'C', bpm: 120 };
    case 'get_audio_metadata':
      return { path: args.path, title: '샘플 곡', artist: '샘플 아티스트', duration: '4:47', thumbnail: '', source: 'youtube' };
    // 통합 검색 — 브라우저(정적 프리뷰)에서 UI를 시험할 수 있게 샘플 응답
    case 'search_youtube':
      return [
        { id: 'aaa11122233', url: 'https://youtu.be/aaa11122233', title: `${args.query} (Official Audio)`,
          channel: '샘플 아티스트', duration: 287, thumbnail: 'https://i.ytimg.com/vi/aaa11122233/mqdefault.jpg', official: true },
        { id: 'bbb44455566', url: 'https://youtu.be/bbb44455566', title: `[LIVE] ${args.query} 무대 영상`,
          channel: '샘플 방송', duration: 258, thumbnail: 'https://i.ytimg.com/vi/bbb44455566/mqdefault.jpg', official: false },
      ];
    case 'search_lyrics_sites':
      return [
        { title: `${args.query} 가사`, url: 'https://music.bugs.co.kr/track/1804107',
          snippet: '가사 미리보기 샘플 텍스트입니다.', domain: 'music.bugs.co.kr' },
        { title: `${args.query} - 노래 가사`, url: 'https://www.lyrics.co.kr/?p=270496',
          snippet: '두 번째 결과 샘플.', domain: 'lyrics.co.kr' },
      ];
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
