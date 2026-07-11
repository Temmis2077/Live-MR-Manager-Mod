/**
 * src/js/lyrics.js - LRC Lyric Loading Utility
 */

import { invoke } from './tauri-bridge.js';
export { parseLrc } from './lrc-parser.js';
import { parseLrc, parseMarkers } from './lrc-parser.js';

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

/**
 * Reads just the "보컬 시작 지점" marker (if any) from a track's LRC file —
 * used to auto-skip a leading intro (music-video intro, dialogue, etc.) on
 * YouTube-sourced songs. Returns null when there's no LRC file or no marker.
 */
export async function getVocalStartMarker(audioPath) {
  try {
    const content = await invoke('load_lrc_file', { audioPath });
    if (content && content.trim()) {
      return parseMarkers(content).vocalStartSec;
    }
  } catch (err) {
    console.log("[Lyrics] No LRC file found for vocal-start marker lookup:", err);
  }
  return null;
}
