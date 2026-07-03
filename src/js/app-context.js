/**
 * app-context.js - Explicit app-level handler registry (replaces window.* globals)
 */

const handlers = new Map();

export function registerAppHandler(name, fn) {
  handlers.set(name, fn);
}

export function getAppHandler(name) {
  return handlers.get(name);
}

export function callAppHandler(name, ...args) {
  const fn = handlers.get(name);
  if (typeof fn === 'function') {
    return fn(...args);
  }
  return undefined;
}
