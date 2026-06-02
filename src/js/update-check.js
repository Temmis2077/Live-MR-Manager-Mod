/**
 * update-check.js - GitHub release update notifications
 */

import { listen } from './tauri-bridge.js';
import { showUpdateAvailable } from './utils.js';

export function initUpdateChecker() {
  listen('app-update-available', (event) => {
    showUpdateAvailable(event.payload);
  }).catch((err) => {
    console.warn('[Updater] Event listener failed:', err);
  });
}
