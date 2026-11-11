import { useSyncExternalStore } from 'react';

// One subscription to the main process, readable synchronously by key handlers.
let state = { maximized: false, fullScreen: false, focused: true };
const listeners = new Set();
let started = false;

function start() {
  if (started || !window.folio?.frame) return;
  started = true;
  const apply = (next) => {
    if (!next) return;
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };
  window.folio.frame.onState(apply);
  window.folio.frame.state().then(apply).catch(() => {});
}

function subscribe(listener) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function windowState() {
  start();
  return state;
}

export function useWindowState() {
  return useSyncExternalStore(subscribe, windowState);
}

export const isMac = () => window.folio?.platform === 'darwin';
export const modKey = () => (isMac() ? '⌘' : 'Ctrl');
