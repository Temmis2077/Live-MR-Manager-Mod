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

// Shared global setting (alignment editor + lyric drawer + overlay all read
// this): whether the 번역(translation) line of a triplet cue is shown.
// Default off — only 원문(original) + 차음(pronunciation) show out of the box.
const SHOW_TRANSLATION_KEY = 'lyricsShowTranslation';

export function getShowTranslation() {
  return localStorage.getItem(SHOW_TRANSLATION_KEY) === 'true';
}

export function setShowTranslation(show) {
  localStorage.setItem(SHOW_TRANSLATION_KEY, show ? 'true' : 'false');
}

/** Builds the display text for a segment: original(+pronunciation) stacked for
 * triplet cues (translation only if the global setting is on), plain `text`
 * otherwise. `joiner` lets callers pick `\n` (drawer/overlay) vs a literal
 * string for contexts that render each part separately. */
export function getDisplayLines(seg) {
  if (!isTriplet(seg)) return [seg?.text || ''];
  const lines = [seg.original || '', seg.pronunciation || ''].filter((l) => l);
  if (getShowTranslation() && seg.translation) lines.push(seg.translation);
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
