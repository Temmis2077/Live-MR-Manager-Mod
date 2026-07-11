/**
 * lrc-parser.js - Pure LRC parsing (no Tauri dependency)
 */

// Standalone time-region markers (vocal start point, instrumental interlude
// bounds). Unlike section tags these don't own a lyric line, so they're
// encoded as their own marker-only lines, e.g. `[00:12.34][vocalstart]`, and
// parsed separately from `parseLrc()`'s segment list via `parseMarkers()`.
const MARKER_TAGS = ['vocalstart', 'ilstart', 'ilend'];
const markerAlternation = MARKER_TAGS.join('|');
const markerLineRegex = new RegExp(`^\\[(\\d{2}):(\\d{2}\\.\\d{2,3})\\]\\[(${markerAlternation})\\]\\s*$`);
const markerOnlyRegex = new RegExp(`^\\[(${markerAlternation})\\]\\s*$`);

function isMarkerOnlyLine(timeStrippedRest) {
  return markerOnlyRegex.test(timeStrippedRest.trim());
}

/**
 * Extracts the vocal-start anchor and instrumental-interlude regions from
 * raw LRC text. Returns `{ vocalStartSec: number|null, interludes: {start,end}[] }`.
 * `ilstart`/`ilend` markers are paired in chronological order; an unpaired
 * trailing `ilstart` (e.g. file edited by hand) is dropped rather than
 * producing a broken open-ended region.
 */
export function parseMarkers(lrcContent) {
  const result = { vocalStartSec: null, interludes: [] };
  if (!lrcContent) return result;

  const lines = lrcContent.replace(/\r\n/g, '\n').split('\n');
  const ilStarts = [];
  const ilEnds = [];

  lines.forEach((line) => {
    const match = markerLineRegex.exec(line.trim());
    if (!match) return;
    const time = parseInt(match[1], 10) * 60 + parseFloat(match[2]);
    const tag = match[3];
    if (tag === 'vocalstart') {
      result.vocalStartSec = time;
    } else if (tag === 'ilstart') {
      ilStarts.push(time);
    } else if (tag === 'ilend') {
      ilEnds.push(time);
    }
  });

  ilStarts.sort((a, b) => a - b);
  ilEnds.sort((a, b) => a - b);
  const pairCount = Math.min(ilStarts.length, ilEnds.length);
  for (let i = 0; i < pairCount; i++) {
    if (ilEnds[i] > ilStarts[i]) {
      result.interludes.push({ start: ilStarts[i], end: ilEnds[i] });
    }
  }
  return result;
}

export function formatMarkerLine(sec, tag) {
  const min = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toFixed(2).padStart(5, '0');
  return `[${min}:${s}][${tag}]`;
}

function normalizeLyricText(text = '') {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Triplet cues (\uC6D0\uBB38/\uCC28\uC74C/\uBC88\uC5ED \u2014 original/pronunciation/translation), used for
// e.g. Japanese lyrics where one sung moment needs three lines: the original
// script, a Hangul phonetic reading, and a Korean translation. Unlike section
// tags these three lines share ONE timestamp and collapse into a single
// segment. Encoded as three consecutive tagged lines:
//   [00:12.34][orig]<original>
//   [00:12.34][pron]<pronunciation>
//   [00:12.34][tran]<translation>
// Grouping keys off seeing `orig` (always starts a new cue) rather than
// timestamp equality, since unsynced cues all sit at `00:00.00` and would
// otherwise collide into one group.
const TRIPLET_FIELD_BY_TAG = { orig: 'original', pron: 'pronunciation', tran: 'translation' };
const tripletTagRegex = /^\[(orig|pron|tran)\]([\s\S]*)$/;

export function isTriplet(seg) {
  return !!(seg && (seg.original !== undefined || seg.pronunciation !== undefined || seg.translation !== undefined));
}

/** The text sync tools (tap/grid/AI-align) should match against \u2014 pronunciation for
 * triplet cues (closest to the actual sung audio), plain `text` otherwise. */
export function getSyncText(seg) {
  if (!seg) return '';
  return isTriplet(seg) ? (seg.pronunciation || '') : (seg.text || '');
}

// Per-surface triplet line visibility. 'app' covers the sync editor preview
// + the in-app lyric drawer; 'overlay' covers the OBS-facing overlay only —
// letting users show e.g. only 차음 on stream while keeping 원문+차음 in-app,
// or any other combination of 원문/차음/번역 per surface.
const LINE_VISIBILITY_KEY_PREFIX = 'lyricsLineVisibility_';
const DEFAULT_LINE_VISIBILITY = { original: true, pronunciation: true, translation: false };

export function getLineVisibility(scope = 'app') {
  const raw = localStorage.getItem(LINE_VISIBILITY_KEY_PREFIX + scope);
  if (!raw) return { ...DEFAULT_LINE_VISIBILITY };
  try {
    return { ...DEFAULT_LINE_VISIBILITY, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_LINE_VISIBILITY };
  }
}

export function setLineVisibility(scope, key, value) {
  const current = getLineVisibility(scope);
  current[key] = value;
  localStorage.setItem(LINE_VISIBILITY_KEY_PREFIX + scope, JSON.stringify(current));
}

/** Back-compat helpers for the sync editor's single "번역 보기" quick toggle —
 * scoped to 'app' since that toggle only ever affected the in-app preview. */
export function getShowTranslation(scope = 'app') {
  return getLineVisibility(scope).translation;
}

export function setShowTranslation(show, scope = 'app') {
  setLineVisibility(scope, 'translation', show);
}

/** Builds the display lines for a segment per-surface visibility settings.
 * Plain (non-triplet) segments always just return their `text`. If a triplet
 * cue's visible set is empty (user turned everything off for this surface),
 * falls back to the pronunciation line (or whatever's available) rather than
 * rendering nothing. */
export function getDisplayLines(seg, scope = 'app') {
  if (!isTriplet(seg)) return [seg?.text || ''];
  const vis = getLineVisibility(scope);
  const lines = [];
  if (vis.original && seg.original) lines.push(seg.original);
  if (vis.pronunciation && seg.pronunciation) lines.push(seg.pronunciation);
  if (vis.translation && seg.translation) lines.push(seg.translation);
  if (lines.length === 0) {
    const fallback = seg.pronunciation || seg.original || seg.translation || '';
    if (fallback) lines.push(fallback);
  }
  return lines;
}

export function parseLrc(lrcContent, duration = 0) {
  if (!lrcContent) return [];

  const lines = lrcContent.replace(/\r\n/g, '\n').split('\n');
  const segments = [];
  const timeRegex = /\[(\d{2}):(\d{2}\.\d{2,3})\]/;
  const metadataRegex = /^\[[a-zA-Z]{2,8}\s*:[^\]]*\]$/;

  let pendingTriplet = null;
  const flushTriplet = () => {
    if (pendingTriplet) {
      pendingTriplet.text = pendingTriplet.original;
      segments.push(pendingTriplet);
      pendingTriplet = null;
    }
  };

  lines.forEach((line) => {
    const match = timeRegex.exec(line);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseFloat(match[2]);
      const start = min * 60 + sec;
      const timeStr = match[0];
      const rest = line.replace(timeStr, '');
      if (isMarkerOnlyLine(rest)) return; // vocalstart/ilstart/ilend — not a lyric line

      const tripletMatch = tripletTagRegex.exec(rest.trimStart());
      if (tripletMatch) {
        const field = TRIPLET_FIELD_BY_TAG[tripletMatch[1]];
        const text = normalizeLyricText(tripletMatch[2]);
        if (tripletMatch[1] === 'orig' || !pendingTriplet) {
          flushTriplet();
          pendingTriplet = { original: '', pronunciation: '', translation: '', start, end: 0 };
        }
        pendingTriplet[field] = text;
        pendingTriplet.start = start;
        return;
      }

      flushTriplet();
      const text = normalizeLyricText(rest);
      if (text) {
        segments.push({ text, start, end: 0 });
      }
    } else if (line.trim()) {
      flushTriplet();
      const normalized = normalizeLyricText(line);
      if (!normalized) return;
      if (metadataRegex.test(normalized)) return;
      segments.push({ text: normalized, start: 0, end: 0 });
    }
  });
  flushTriplet();

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
