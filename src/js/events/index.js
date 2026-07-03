/**
 * js/events/index.js - Unified Event Initialization
 */
import { initNavigation, switchTab } from './navigation.js';
import { initControlListeners } from './controls/index.js';
import { initModalListeners } from './modals.js';
import { initMelomingListeners } from './meloming.js';
import { setupBackendListeners } from './backend.js';

export { switchTab };

export async function initAllEvents() {
  initNavigation();
  initControlListeners();
  initModalListeners();
  await initMelomingListeners();
  await setupBackendListeners();
}
