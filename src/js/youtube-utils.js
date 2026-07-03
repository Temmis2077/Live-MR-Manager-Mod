/**
 * youtube-utils.js - Shared YouTube URL parsing helpers
 */

export function extractYoutubeVideoId(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] || null;
    }
    if (host.endsWith("youtube.com")) {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v");
      }
      if (parsed.pathname.startsWith("/shorts/") || parsed.pathname.startsWith("/embed/")) {
        return parsed.pathname.split("/").filter(Boolean)[1] || null;
      }
    }
  } catch (_) {
    // fall through to regex fallback
  }
  const shortMatch = trimmed.match(/youtu\.be\/([^?&#/]+)/i);
  if (shortMatch?.[1]) return shortMatch[1];
  const watchMatch = trimmed.match(/[?&]v=([^&#/]+)/i);
  if (watchMatch?.[1]) return watchMatch[1];
  return null;
}

/** @deprecated Use extractYoutubeVideoId */
export function youtubeVideoIdFromPath(path) {
  return extractYoutubeVideoId(path);
}

export function normalizeYoutubeKey(raw) {
  const videoId = extractYoutubeVideoId(raw);
  if (videoId) return `yt:${videoId}`;
  return String(raw || "").trim().toLowerCase();
}

export function normalizeYoutubeUrl(raw) {
  const videoId = extractYoutubeVideoId(raw);
  return videoId ? `https://youtu.be/${videoId}` : String(raw || "").trim();
}

export function youtubePathsMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const aId = extractYoutubeVideoId(a);
  const bId = extractYoutubeVideoId(b);
  return !!(aId && bId && aId === bId);
}

export function isDuplicateYoutubeTrack(library, requestedUrl, metadata) {
  const candidateKeys = new Set([
    normalizeYoutubeKey(requestedUrl),
    normalizeYoutubeKey(metadata?.path),
  ]);

  return (library || []).some((song) => {
    if (!song) return false;
    if (metadata?.path && song.path === metadata.path) return true;
    return candidateKeys.has(normalizeYoutubeKey(song.path));
  });
}
