/**
 * Pure library filter/sort logic (testable without DOM)
 */

export function getSongCategoryFromMetadata(song) {
  if (!song) return "";
  if (song.categories && song.categories.length > 0) {
    const first = String(song.categories[0] || "").trim();
    if (first) return first;
  }
  if (song.category && String(song.category).trim()) return String(song.category).trim();
  if (song.curationCategory && String(song.curationCategory).trim()) {
    return String(song.curationCategory).trim();
  }
  return "";
}

export function isMelomingLinkedSong(song) {
  if (!song) return false;
  if (song.source === "meloming") return true;
  const songId = song.melomingSongId ?? song.meloming_song_id;
  return songId != null && songId !== "";
}

export function filterSongLibrary(songs, {
  query = "",
  genreFilter = "all",
  categoryFilter = "all",
  sortBy = "dateNew",
  currentTab = "library",
} = {}) {
  let filtered = songs.map((s, i) => ({ ...s, originalIndex: i }));

  if (currentTab === "youtube") filtered = filtered.filter(s => s.source === "youtube");
  else if (currentTab === "local") filtered = filtered.filter(s => s.source === "local");
  else if (currentTab === "meloming") filtered = filtered.filter(isMelomingLinkedSong);

  const normalizedQuery = String(query || "").toLowerCase().trim();
  if (normalizedQuery) {
    filtered = filtered.filter(s =>
      s.title?.toLowerCase().includes(normalizedQuery) ||
      (s.artist && s.artist.toLowerCase().includes(normalizedQuery)) ||
      (s.genre && s.genre.toLowerCase().includes(normalizedQuery)) ||
      getSongCategoryFromMetadata(s).toLowerCase().includes(normalizedQuery) ||
      (s.tags && s.tags.some(t => t.toLowerCase().includes(normalizedQuery)))
    );
  }

  if (genreFilter !== "all" && genreFilter !== "") {
    filtered = filtered.filter(s => s.genre === genreFilter);
  }

  if (categoryFilter !== "all" && categoryFilter !== "") {
    filtered = filtered.filter(
      (s) =>
        getSongCategoryFromMetadata(s) === categoryFilter ||
        (s.categories && s.categories.includes(categoryFilter))
    );
  }

  filtered.sort((a, b) => {
    switch (sortBy) {
      case "title": return (a.title || "").localeCompare(b.title || "");
      case "dateNew": return (b.dateAdded || 0) - (a.dateAdded || 0);
      case "dateOld": return (a.dateAdded || 0) - (b.dateAdded || 0);
      case "plays": return (b.playCount || 0) - (a.playCount || 0);
      default: return 0;
    }
  });

  return filtered;
}
