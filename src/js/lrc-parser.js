/**
 * lrc-parser.js - Pure LRC parsing (no Tauri dependency)
 */

function normalizeLyricText(text = '') {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function parseLrc(lrcContent, duration = 0) {
  if (!lrcContent) return [];

  const lines = lrcContent.replace(/\r\n/g, '\n').split('\n');
  const segments = [];
  const timeRegex = /\[(\d{2}):(\d{2}\.\d{2,3})\]/;
  const metadataRegex = /^\[[a-zA-Z]{2,8}\s*:[^\]]*\]$/;

  lines.forEach((line) => {
    const match = timeRegex.exec(line);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseFloat(match[2]);
      const timeStr = match[0];
      const text = normalizeLyricText(line.replace(timeStr, ''));
      if (text) {
        segments.push({ text, start: min * 60 + sec, end: 0 });
      }
    } else if (line.trim()) {
      const normalized = normalizeLyricText(line);
      if (!normalized) return;
      if (metadataRegex.test(normalized)) return;
      segments.push({ text: normalized, start: 0, end: 0 });
    }
  });

  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].start > 0 && segments[i + 1].start > 0) {
      segments[i].end = segments[i + 1].start;
    } else {
      segments[i].end = 0;
    }
  }

  if (segments.length > 0) {
    segments[segments.length - 1].end = duration > 0 ? duration : 0;
  }

  return segments;
}
