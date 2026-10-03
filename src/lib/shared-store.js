// src/lib/shared-store.js
import { writable, get } from 'svelte/store';

const KEY = 'mote:sharedIndex';

/**
 * Index of shared lists this device knows about.
 * Shape: { [token]: { token, title, kind, listStyle, role, lastSeen } }
 * role: 'owner' | 'member'
 */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persist(value) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {}
}

export const sharedIndex = writable(load());

sharedIndex.subscribe(persist);

/**
 * Add or update a shared list's entry in the local index.
 */
export function rememberShared(token, metadata) {
  sharedIndex.update((idx) => ({
    ...idx,
    [token]: {
      ...idx[token],
      ...metadata,
      token,
      lastSeen: new Date().toISOString(),
    },
  }));
}

export function forgetShared(token) {
  sharedIndex.update((idx) => {
    const copy = { ...idx };
    delete copy[token];
    return copy;
  });
}

export function listRememberedShared() {
  const idx = get(sharedIndex);
  return Object.values(idx).sort((a, b) =>
    (a.lastSeen || '') < (b.lastSeen || '') ? 1 : -1
  );
}