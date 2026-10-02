// src/lib/sync-store.js
import { writable, derived, get } from 'svelte/store';
import { authUser } from './auth.js';
import { syncKey } from './sync-key.js';
import { reconcile, incrementalSync, pushNote } from './sync.js';

// ── Status surface for UI ────────────────────────────────────
export const syncStatus = writable('idle');
export const lastSyncedAt = writable(null);
export const syncError = writable(null);

export const canSync = derived(
  [authUser, syncKey],
  ([$u, $k]) => !!$u && !$k.locked && !!$k.key
);

// ── Internal state ───────────────────────────────────────────
let initialSyncDone = false;
let periodicTimer = null;
const pushQueue = new Map();
const PUSH_DEBOUNCE_MS = 2500;
const PERIODIC_INTERVAL_MS = 5 * 60 * 1000;

// ═══════════════════════════════════════════════════════════
// FULL SYNC
// ═══════════════════════════════════════════════════════════

export async function runFullSync() {
  const user = get(authUser);
  const sk = get(syncKey);
  if (!user || sk.locked || !sk.key) {
    syncStatus.set('locked');
    return null;
  }

  syncStatus.set('syncing');
  syncError.set(null);

  try {
    const result = await reconcile(user.uid, sk.key);
    lastSyncedAt.set(new Date());
    syncStatus.set('synced');
    initialSyncDone = true;

    setTimeout(() => {
      if (get(syncStatus) === 'synced') syncStatus.set('idle');
    }, 1500);

    return result;
  } catch (err) {
    console.error('[sync-store] full sync failed:', err);
    syncError.set(err.message || 'Sync failed.');
    syncStatus.set(navigator.onLine ? 'error' : 'offline');
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════
// INCREMENTAL SYNC
// ═══════════════════════════════════════════════════════════

export async function runIncrementalSync() {
  const user = get(authUser);
  const sk = get(syncKey);
  if (!user || sk.locked || !sk.key) return null;

  if (!initialSyncDone) return runFullSync();

  const since = get(lastSyncedAt)?.toISOString() || new Date(0).toISOString();

  syncStatus.set('syncing');
  try {
    const result = await incrementalSync(user.uid, sk.key, since);
    lastSyncedAt.set(new Date());
    syncStatus.set('idle');
    return result;
  } catch (err) {
    console.error('[sync-store] incremental sync failed:', err);
    syncStatus.set(navigator.onLine ? 'error' : 'offline');
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// PER-NOTE PUSH
// ═══════════════════════════════════════════════════════════

export function queueNotePush(noteId) {
  const user = get(authUser);
  const sk = get(syncKey);
  if (!user || sk.locked || !sk.key) return;

  const existing = pushQueue.get(noteId);
  if (existing) clearTimeout(existing);

  const handle = setTimeout(async () => {
    pushQueue.delete(noteId);

    const current = get(syncKey);
    const stillUser = get(authUser);
    if (!stillUser || current.locked || !current.key) return;

    syncStatus.set('syncing');
    try {
      await pushNote(stillUser.uid, current.key, noteId);
      lastSyncedAt.set(new Date());
      syncStatus.set('idle');
    } catch (err) {
      console.error('[sync-store] push failed:', err);
      syncStatus.set(navigator.onLine ? 'error' : 'offline');
    }
  }, PUSH_DEBOUNCE_MS);

  pushQueue.set(noteId, handle);
}

// ═══════════════════════════════════════════════════════════
// LIFECYCLE
// ═══════════════════════════════════════════════════════════

export function startPeriodicSync() {
  if (periodicTimer) return;
  periodicTimer = setInterval(() => {
    if (navigator.onLine) runIncrementalSync();
  }, PERIODIC_INTERVAL_MS);
}

export function stopPeriodicSync() {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}

export function handleOnline() {
  if (get(syncStatus) === 'offline') runIncrementalSync();
}

export function handleOffline() {
  syncStatus.set('offline');
}

export function resetSyncState() {
  initialSyncDone = false;
  for (const handle of pushQueue.values()) clearTimeout(handle);
  pushQueue.clear();
  syncStatus.set('idle');
  lastSyncedAt.set(null);
  syncError.set(null);
}