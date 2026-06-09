/**
 * js/ui/modals.js - Modal Management (Edit, Confirm, etc.)
 */
import { state } from '../state.js';
import { elements } from './elements.js';
import { getSongCategory } from './library.js';
import { applyRatingSelectLabel } from '../utils.js';

function setRatingDropdown(dropdownId, hiddenId, value) {
  const dropdown = document.getElementById(dropdownId);
  const hidden = document.getElementById(hiddenId);
  if (!dropdown || !hidden) return;

  const val = value != null && value !== "" ? String(value) : "";
  hidden.value = val;

  const selectedText = dropdown.querySelector(".selected-text");
  const options = dropdown.querySelectorAll(".option-item");
  let matched = false;

  options.forEach((opt) => {
    const isSelected = opt.dataset.value === val;
    opt.classList.toggle("selected", isSelected);
    if (isSelected) matched = true;
  });

  applyRatingSelectLabel(selectedText, val);
  if (!matched) {
    options.forEach((opt) => opt.classList.toggle("selected", opt.dataset.value === ""));
  }
}

export function openEditModal(song, index) {
  if (!elements.metadataModal) return;
  
  state.editingSongIndex = index;
  
  // Fill modal fields
  document.getElementById("edit-title").value = song.title || "";
  document.getElementById("edit-artist").value = song.artist || "";
  
  // Genre Handling
  const genreSelect = document.getElementById("edit-genre-select");
  const genreCustom = document.getElementById("edit-genre-custom");
  const genreDropdown = document.getElementById("edit-genre-dropdown");
  
  if (genreSelect && genreCustom && genreDropdown) {
    const defaultGenres = ["pop", "ballad", "dance", "rock", "jpop", "kpop", "etc"];
    const songGenre = (song.genre || "").toLowerCase();
    
    if (defaultGenres.includes(songGenre)) {
      genreSelect.value = songGenre;
      genreCustom.value = "";
      
      const selectedOption = genreDropdown.querySelector(`.option-item[data-value='${songGenre}']`);
      const selectedText = genreDropdown.querySelector(".selected-text");
      if (selectedOption && selectedText) {
        selectedText.textContent = selectedOption.textContent;
        genreDropdown.querySelectorAll(".option-item").forEach(opt => opt.classList.remove("selected"));
        selectedOption.classList.add("selected");
      }
    } else {
      genreSelect.value = "etc";
      genreCustom.value = song.genre || "";
      
      const selectedOption = genreDropdown.querySelector(".option-item[data-value='etc']");
      const selectedText = genreDropdown.querySelector(".selected-text");
      if (selectedOption && selectedText) {
        selectedText.textContent = selectedOption.textContent;
        genreDropdown.querySelectorAll(".option-item").forEach(opt => opt.classList.remove("selected"));
        selectedOption.classList.add("selected");
      }
    }
  }

  document.getElementById("edit-category").value = getSongCategory(song) || "기본";
  document.getElementById("edit-tags").value = (song.tags || []).join(", ");
  const editVolume = document.getElementById("edit-volume");
  const editVolumeVal = document.getElementById("edit-volume-val");
  const editKey = document.getElementById("edit-key");
  const editBpm = document.getElementById("edit-bpm");
  if (editVolume) {
    const min = Number.parseFloat(editVolume.min || "0");
    const max = Number.parseFloat(editVolume.max || "120");
    const volume = Number.parseFloat(song.volume);
    const safeVolume = Number.isFinite(volume) ? Math.max(min, Math.min(max, volume)) : 100;
    editVolume.value = String(Math.round(safeVolume));
    if (editVolumeVal) editVolumeVal.textContent = String(Math.round(safeVolume));
  }
  if (editKey) {
    editKey.value = song.songKey || song.key || "";
  }
  if (editBpm) {
    editBpm.value = song.bpm ?? "";
  }
  setRatingDropdown("edit-difficulty-dropdown", "edit-difficulty-select", song.difficulty);
  setRatingDropdown("edit-proficiency-dropdown", "edit-proficiency-select", song.proficiency);

  // MR Checkbox initialization
  const mrCheckbox = document.getElementById("edit-is-mr");
  if (mrCheckbox) {
    const isSeparated = !!(song.is_separated || song.isSeparated);
    mrCheckbox.checked = isSeparated || !!(song.is_mr || song.isMr);
    mrCheckbox.disabled = isSeparated;
    
    // Add visual feedback for disabled state
    const label = mrCheckbox.closest(".mr-checkbox-label");
    if (label) label.classList.toggle("disabled", isSeparated);
  }

  elements.metadataModal.classList.add("active");
}

export function closeEditModal() {
  if (elements.metadataModal) {
    elements.metadataModal.classList.remove("active");
    // Reset disabled state for next open
    const mrCheckbox = document.getElementById("edit-is-mr");
    if (mrCheckbox) {
      mrCheckbox.disabled = false;
      const label = mrCheckbox.closest(".mr-checkbox-label");
      if (label) label.classList.remove("disabled");
    }
  }
  state.editingSongIndex = null;
}

export function openConfirmModal(title, message, onConfirm) {
  if (!elements.confirmModal) return;
  
  const titleEl = elements.confirmModal.querySelector("h3");
  const msgEl = elements.confirmModal.querySelector("p");
  // Prefer current button IDs, but keep legacy fallback for compatibility.
  const confirmBtn = document.getElementById("confirm-ok") || document.getElementById("confirm-yes");
  const cancelBtn = document.getElementById("confirm-cancel") || document.getElementById("confirm-no");
  
  if (!confirmBtn || !cancelBtn) {
    console.error("[openConfirmModal] Confirm/Cancel buttons not found");
    return;
  }
  
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  
  confirmBtn.onclick = () => {
    onConfirm();
    closeConfirmModal();
  };
  
  cancelBtn.onclick = closeConfirmModal;
  
  elements.confirmModal.classList.add("active");
}

export function closeConfirmModal() {
  if (elements.confirmModal) elements.confirmModal.classList.remove("active");
}
