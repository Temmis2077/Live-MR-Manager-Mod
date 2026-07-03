/**
 * YouTube URL fetch control listeners
 */
import { state } from '../../state.js';
import { elements } from '../../ui/elements.js';
import { getAudioMetadata, saveLibrary } from '../../audio.js';
import { showNotification } from '../../utils.js';
import { extractYoutubeVideoId, isDuplicateYoutubeTrack, normalizeYoutubeUrl } from '../../youtube-utils.js';

export function initYoutubeListeners() {
  if (!elements.ytFetchBtn || !elements.ytUrlInput) return;

  elements.ytFetchBtn.onclick = async () => {
    const url = elements.ytUrlInput.value.trim();
    if (!url) return;
    const normalizedUrl = normalizeYoutubeUrl(url);
    elements.ytFetchBtn.classList.add("loading-btn");
    elements.ytFetchBtn.disabled = true;
    try {
      const metadata = await getAudioMetadata(normalizedUrl);

      if (isDuplicateYoutubeTrack(state.songLibrary, normalizedUrl, metadata)) {
        showNotification("이미 등록된 곡입니다.", "warning");
        return;
      }

      state.songLibrary.push(metadata);
      await saveLibrary(state.songLibrary);
      elements.ytUrlInput.value = "";
      showNotification("추가되었습니다.", "success");
      const { renderLibrary } = await import('../../ui/library.js');
      const { refreshFilterDropdowns } = await import('../../ui/core.js');
      await refreshFilterDropdowns();
      renderLibrary();
    } catch (err) {
      showNotification("정보를 가져오는데 실패했습니다.", "error");
    } finally {
      elements.ytFetchBtn.classList.remove("loading-btn");
      elements.ytFetchBtn.disabled = false;
    }
  };

  elements.ytUrlInput.onkeydown = (e) => {
    if (e.key === "Enter") elements.ytFetchBtn.click();
  };
}

export { extractYoutubeVideoId };
