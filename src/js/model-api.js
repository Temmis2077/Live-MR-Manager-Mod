/**
 * model-api.js - AI model command wrappers
 */

import { invoke } from './tauri-bridge.js';

export async function getModelSettings() {
  return invoke('get_model_settings');
}

export async function updateModelSettings(modelId) {
  return invoke('update_model_settings', { modelId });
}

export async function checkModelReady(modelId) {
  return invoke('check_model_ready', { modelId });
}

export async function downloadAiModel(modelId) {
  return invoke('download_ai_model', { modelId });
}

export async function deleteAiModel(modelId) {
  return invoke('delete_ai_model', { modelId });
}

export async function getActiveSeparations() {
  return invoke('get_active_separations');
}
