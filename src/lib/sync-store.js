// src/lib/sync-store.js
import { writable, derived, get } from 'svelte/store';
import { authUser } from './auth.js';
import { syncKey, setSyncKey, lockSyncKey } from './sync-key.js';
import {
  reconcile,
  incrementalSync,
  pushNote,
  watchRemoteNotes,
} from './sync.js';
import { onNoteSaved } from './db.js';
import { saveDeviceKey, loadDeviceKey } from './key-vault.js';

// ── Status surface for UI ────────────────────────────────────
export const syncStatus = writable('idle');
export const lastSyncedAt = writable(null);
export const syncError = writable(null);

/**
 * Bumps every time sync wrote notes into local storage (full sync or a
 * live change from another device). Subscribe to it in App.svelte and
 * reload the notes list when it changes.
 */
export const notesVersion = writable(0);

export const canSync = derived(
  [authUser, syncKey],
  ([$u, $k]) => !!$u && !$k.locked && !!$k.key
);

// ── Internal state ───────────────────────────────────────────
let initialSyncDone = false;
let periodicTimer = null;
const pushQueue = new Map();
const PUSH_DEBOUNCE_MS = 800;
const PERIODIC_INTERVAL_MS = 5 * 60 * 1000;

let stopRealtime = null;
let activeUid = null;
let activeKey = null;
let persistedKey = null;

function bumpNotes() {
  notesVersion.update((n) => n + 1);
}

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
// INCREMENTAL SYNC (safety net; realtime does the real work)
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
    if (result?.pulled > 0) bumpNotes();
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

async function pushNow(noteId) {
  const current = get(syncKey);
  const user = get(authUser);
  if (!user || current.locked || !current.key) return;

  syncStatus.set('syncing');
  try {
    await pushNote(user.uid, current.key, noteId);
    lastSyncedAt.set(new Date());
    syncStatus.set('idle');
  } catch (err) {
    console.error('[sync-store] push failed:', err);
    syncStatus.set(navigator.onLine ? 'error' : 'offline');
  }
}

export function queueNotePush(noteId) {
  const user = get(authUser);
  const sk = get(syncKey);
  if (!user || sk.locked || !sk.key) return;

  const existing = pushQueue.get(noteId);
  if (existing) clearTimeout(existing);

  const handle = setTimeout(() => {
    pushQueue.delete(noteId);
    pushNow(noteId);
  }, PUSH_DEBOUNCE_MS);

  pushQueue.set(noteId, handle);
}

/** Push everything waiting in the debounce queue right now. */
export function flushPushes() {
  for (const [noteId, handle] of pushQueue) {
    clearTimeout(handle);
    pushNow(noteId);
  }
  pushQueue.clear();
}

// Every local save goes to the cloud. Calling queueNotePush from other
// places as well is harmless: the queue is keyed by note id.
onNoteSaved((note) => queueNotePush(note.id));

// ═══════════════════════════════════════════════════════════
// AUTOMATIC UNLOCK + REALTIME SESSION
// ═══════════════════════════════════════════════════════════

async function restoreDeviceKey(uid) {
  if (!get(syncKey).locked) return;

  const stored = await loadDeviceKey(uid);
  if (!stored) return;

  // The user or the lock state may have changed while we were reading
  if (get(authUser)?.uid !== uid || !get(syncKey).locked) return;

  persistedKey = stored.key; // already stored, no need to save again
  setSyncKey({ key: stored.key, salt: stored.salt });
}

function stopRealtimeListener() {
  if (stopRealtime) {
    stopRealtime();
    stopRealtime = null;
  }
}

function startRealtimeListener(uid, key) {
  stopRealtimeListener();
  stopRealtime = watchRemoteNotes(uid, key, {
    onApplied: () => {
      lastSyncedAt.set(new Date());
      bumpNotes();
    },
    onError: () => {
      syncStatus.set(navigator.onLine ? 'error' : 'offline');
    },
  });
}

async function startSession(uid, key, salt) {
  // Remember the key on this device so a refresh unlocks automatically
  if (persistedKey !== key) {
    persistedKey = key;
    saveDeviceKey(uid, key, salt).catch((err) =>
      console.warn('[sync-store] could not save device key:', err)
    );
  }

  try {
    const result = await runFullSync();
    if (result && result.pulled > 0) bumpNotes();
  } catch {
    // Status is already set; the realtime listener will still start
  }

  // Signed out or locked while the first sync was running
  if (activeUid !== uid || activeKey !== key) return;

  startRealtimeListener(uid, key);
}

function reevaluate() {
  const user = get(authUser);
  const sk = get(syncKey);
  const ready = !!user && !sk.locked && !!sk.key;

  if (!ready) {
    if (activeKey) {
      stopRealtimeListener();
      activeUid = null;
      activeKey = null;
      initialSyncDone = false;
    }
    return;
  }

  if (activeUid === user.uid && activeKey === sk.key) return;

  activeUid = user.uid;
  activeKey = sk.key;
  startSession(user.uid, sk.key, sk.salt);
}

authUser.subscribe((user) => {
  if (user) {
    restoreDeviceKey(user.uid);
  } else if (!get(syncKey).locked) {
    // Signed out: never leave a previous account's key in memory
    persistedKey = null;
    lockSyncKey();
  }
  reevaluate();
});
syncKey.subscribe(reevaluate);

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

export async function handleOnline() {
  const status = get(syncStatus);
  if (status !== 'offline' && status !== 'error') return;
  // A full reconcile also re-sends edits that failed while offline
  try {
    const result = await runFullSync();
    if (result && result.pulled > 0) bumpNotes();
  } catch {}
}

export function handleOffline() {
  syncStatus.set('offline');
}

export function resetSyncState() {
  stopRealtimeListener();
  activeUid = null;
  activeKey = null;
  persistedKey = null;
  initialSyncDone = false;
  for (const handle of pushQueue.values()) clearTimeout(handle);
  pushQueue.clear();
  syncStatus.set('idle');
  lastSyncedAt.set(null);
  syncError.set(null);
}

// Send pending edits before the page goes away or the app is backgrounded
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPushes);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPushes();
  });
}