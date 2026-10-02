// src/lib/sync-key.js
import { writable, get } from 'svelte/store';

const initial = {
  key: null,
  salt: null,
  phrase: null,
  locked: true,
  biometricAvailable: false,
};

export const syncKey = writable(initial);

export function setSyncKey({ key, salt, phrase = null }) {
  syncKey.update((s) => ({
    ...s,
    key,
    salt,
    phrase,
    locked: false,
  }));
}

export function lockSyncKey() {
  syncKey.update((s) => ({
    ...s,
    key: null,
    phrase: null,
    locked: true,
  }));
}

export function clearSyncKey() {
  syncKey.set(initial);
}

export function isUnlocked() {
  const s = get(syncKey);
  return !s.locked && s.key != null;
}

export function setBiometricAvailable(available) {
  syncKey.update((s) => ({ ...s, biometricAvailable: !!available }));
}