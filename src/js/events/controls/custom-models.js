/**
 * Custom AI separation model management (add / list / remove).
 */
import {
  listModelPresets,
  listCustomModels,
  addCustomModel,
  removeCustomModel,
} from '../../model-api.js';
import { refreshModelDropdown } from './ai.js';

let presetsCache = [];

async function notify(message, type) {
  const { showNotification } = await import('../../utils.js');
  showNotification(message, type);
}

function openModal() {
  const modal = document.getElementById('custom-model-modal');
  if (modal) modal.classList.add('active');
}

function closeModal() {
  const modal = document.getElementById('custom-model-modal');
  if (modal) modal.classList.remove('active');
}

async function populatePresets() {
  const optionsContainer = document.getElementById('cm-preset-options');
  if (!optionsContainer) return;
  try {
    presetsCache = await listModelPresets();
  } catch (err) {
    console.error('Failed to list presets:', err);
    presetsCache = [];
  }
  optionsContainer.innerHTML = presetsCache
    .map((p) => `<div class="option-item" data-value="${p.key}">${p.label}</div>`)
    .join('');
}

function updatePresetDesc(key) {
  const descEl = document.getElementById('cm-preset-desc');
  if (!descEl) return;
  const preset = presetsCache.find((p) => p.key === key);
  descEl.textContent = preset ? preset.description : '';
}

async function renderCustomList() {
  const listEl = document.getElementById('cm-list');
  if (!listEl) return;
  let models = [];
  try {
    models = await listCustomModels();
  } catch (err) {
    console.error('Failed to list custom models:', err);
  }
  if (!models.length) {
    listEl.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);">등록된 커스텀 모델이 없습니다.</div>';
    return;
  }
  listEl.innerHTML = models
    .map((m) => {
      const preset = presetsCache.find((p) => p.key === m.presetKey);
      const presetLabel = preset ? preset.label : m.presetKey;
      const via = m.url ? 'URL' : '로컬 파일';
      return `
        <div class="cm-list-row" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;background:var(--surface-1);border:1px solid var(--glass-border);border-radius:8px;margin-bottom:8px;">
          <div style="min-width:0;">
            <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${m.name}</div>
            <div style="font-size:.72rem;color:var(--text-muted);">${presetLabel} · ${via}</div>
          </div>
          <button class="btn-ai-action danger cm-remove-btn" data-id="${m.id}" style="width:auto;padding:0 14px;white-space:nowrap;">삭제</button>
        </div>`;
    })
    .join('');

  listEl.querySelectorAll('.cm-remove-btn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      try {
        await removeCustomModel(id);
        await notify('커스텀 모델이 삭제되었습니다.', 'info');
        await renderCustomList();
        await refreshModelDropdown();
      } catch (err) {
        await notify('삭제 실패: ' + err, 'error');
      }
    };
  });
}

export function initCustomModelListeners() {
  const openBtn = document.getElementById('btn-manage-custom-models');
  const closeBtn = document.getElementById('custom-model-close');
  const addBtn = document.getElementById('cm-add-btn');
  const nameInput = document.getElementById('cm-name');
  const presetHidden = document.getElementById('cm-preset');
  const urlInput = document.getElementById('cm-url');

  if (openBtn) {
    openBtn.onclick = async () => {
      await populatePresets();
      await renderCustomList();
      updatePresetDesc(presetHidden ? presetHidden.value : '');
      openModal();
    };
  }

  if (closeBtn) closeBtn.onclick = closeModal;

  // Source kind radio toggles the URL input visibility.
  document.querySelectorAll('input[name="cm-source"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (urlInput) urlInput.style.display = radio.value === 'url' && radio.checked ? 'block' : 'none';
    });
  });

  // Preset selection (custom-select fires an input/change on the hidden field).
  if (presetHidden) {
    presetHidden.addEventListener('change', () => updatePresetDesc(presetHidden.value));
    presetHidden.addEventListener('input', () => updatePresetDesc(presetHidden.value));
  }

  if (addBtn) {
    addBtn.onclick = async () => {
      const name = (nameInput?.value || '').trim();
      const presetKey = presetHidden?.value || '';
      const sourceKindEl = document.querySelector('input[name="cm-source"]:checked');
      const sourceKind = sourceKindEl ? sourceKindEl.value : 'file';
      const source = sourceKind === 'url' ? (urlInput?.value || '').trim() : '';

      if (!name) { await notify('모델 이름을 입력해주세요.', 'warning'); return; }
      if (!presetKey) { await notify('아키텍처 프리셋을 선택해주세요.', 'warning'); return; }
      if (sourceKind === 'url' && !source) { await notify('다운로드 URL을 입력해주세요.', 'warning'); return; }

      addBtn.disabled = true;
      try {
        await addCustomModel({ name, sourceKind, source, presetKey });
        await notify('커스텀 모델이 추가되었습니다.', 'success');
        if (nameInput) nameInput.value = '';
        if (urlInput) urlInput.value = '';
        await renderCustomList();
        await refreshModelDropdown();
      } catch (err) {
        const msg = String(err);
        if (!msg.includes('CANCELLED')) await notify('모델 추가 실패: ' + msg, 'error');
      } finally {
        addBtn.disabled = false;
      }
    };
  }
}
