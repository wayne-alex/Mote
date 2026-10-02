// src/lib/db.js
import { openDB } from 'idb';

const DB_NAME = 'mote';
const DB_VERSION = 1;
const STORE = 'notes';

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
          store.createIndex('createdAt', 'createdAt');
          store.createIndex('kind', 'kind');
          store.createIndex('tags', 'tags', { multiEntry: true });
          store.createIndex('deletedAt', 'deletedAt');
          store.createIndex('pinned', 'pinned');
        }
      },
    });
  }
  return dbPromise;
}

// ═══════════════════════════════════════════════════════════
// LISTENERS — notify the sync engine of local user-initiated changes
// ═══════════════════════════════════════════════════════════

const saveListeners = new Set();

/**
 * Register a callback that fires whenever a single note is written
 * via putNote(). Sync uses this to know what to upload.
 * Returns an unsubscribe function.
 *
 * Note: bulkUpsertNotes does NOT trigger these listeners. Bulk writes
 * come from sync itself, and triggering a push would cause an
 * infinite loop.
 */
export function onNoteSaved(callback) {
  saveListeners.add(callback);
  return () => saveListeners.delete(callback);
}

function notifySaved(note) {
  for (const cb of saveListeners) {
    try { cb(note); }
    catch (err) { console.warn('[db] save listener error:', err); }
  }
}

// ═══════════════════════════════════════════════════════════
// NOTES — public API
// ═══════════════════════════════════════════════════════════

export async function getNote(id) {
  const db = await getDB();
  return db.get(STORE, id);
}

export async function putNote(note) {
  const db = await getDB();
  await db.put(STORE, note);
  notifySaved(note);
  return note;
}

export async function deleteNote(id) {
  const db = await getDB();
  await db.delete(STORE, id);
}

export async function listNotes() {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE, 'updatedAt');
  return all.reverse();
}

export async function countNotes() {
  const db = await getDB();
  return db.count(STORE);
}

export async function getMostRecentNote() {
  const db = await getDB();
  const cursor = await db.transaction(STORE).store.index('updatedAt').openCursor(null, 'prev');
  return cursor ? cursor.value : null;
}

/**
 * Return notes that are not soft-deleted, newest first.
 */
export async function listActiveNotes() {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE, 'updatedAt');
  return all
    .filter((n) => !n.deletedAt)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/**
 * Return soft-deleted notes, most recently deleted first.
 */
export async function listTrashNotes() {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE, 'updatedAt');
  return all
    .filter((n) => !!n.deletedAt)
    .sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
}

/**
 * Return every note in the database, active and trashed.
 */
export async function listAllNotes() {
  const db = await getDB();
  return db.getAll(STORE);
}

/**
 * Soft-delete: set deletedAt, keep the row so restore is possible.
 */
export async function softDeleteNote(id) {
  const db = await getDB();
  const note = await db.get(STORE, id);
  if (!note) return;
  note.deletedAt = new Date().toISOString();
  note.updatedAt = note.deletedAt;
  await db.put(STORE, note);
  notifySaved(note);
}

/**
 * Restore a soft-deleted note.
 */
export async function restoreNote(id) {
  const db = await getDB();
  const note = await db.get(STORE, id);
  if (!note) return;
  note.deletedAt = null;
  note.updatedAt = new Date().toISOString();
  await db.put(STORE, note);
  notifySaved(note);
}

/**
 * Permanently remove a note.
 */
export async function purgeNote(id) {
  const db = await getDB();
  await db.delete(STORE, id);
}

/**
 * Permanently remove every soft-deleted note.
 */
export async function emptyTrash() {
  const db = await getDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const all = await store.getAll();
  let purged = 0;
  for (const note of all) {
    if (note.deletedAt) {
      store.delete(note.id);
      purged++;
    }
  }
  await tx.done;
  return purged;
}

/**
 * Return storage stats for the Settings screen.
 */
export async function storageStats() {
  const db = await getDB();
  const all = await db.getAll(STORE);
  const active = all.filter((n) => !n.deletedAt).length;
  const trash = all.filter((n) => !!n.deletedAt).length;
  const bytes = new Blob([JSON.stringify(all)]).size;
  return { total: all.length, active, trash, bytes };
}

/**
 * Wipe everything. Used by "Sign out and clear local data".
 */
export async function wipeAll() {
  const db = await getDB();
  await db.clear(STORE);
}

// ═══════════════════════════════════════════════════════════
// EXPORT / IMPORT
// ═══════════════════════════════════════════════════════════

/**
 * Upsert a single note wholesale (used by import).
 */
export async function upsertNote(note) {
  const db = await getDB();
  const existing = await db.get(STORE, note.id);
  await db.put(STORE, note);
  return !existing;
}

/**
 * Bulk-upsert a list of notes in a single transaction.
 * Does NOT trigger save listeners — bulk writes come from import
 * or sync, neither of which should re-trigger a push.
 */
export async function bulkUpsertNotes(notes) {
  const db = await getDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  let created = 0;
  let updated = 0;

  for (const note of notes) {
    const existing = await store.get(note.id);
    if (existing) updated++;
    else created++;
    store.put(note);
  }

  await tx.done;
  return { created, updated, total: notes.length };
}