/**
 * src/js/lyrics.js - LRC Lyric Loading Utility
 */

import { invoke } from './tauri-bridge.js';
export { parseLrc } from './lrc-parser.js';
import { parseLrc } from './lrc-parser.js';

export async function loadLyricsForTrack(audioPath, duration = 0) {
  try {
    const content = await invoke('load_lrc_file', { audioPath });
    if (content && content.trim()) {
      return parseLrc(content, duration);
    }
  } catch (err) {
    console.log("[Lyrics] No LRC file found or load failed:", err);
  }
  return [];
}
