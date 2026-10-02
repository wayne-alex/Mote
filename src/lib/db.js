// @ts-nocheck
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

export async function getNote(id) {
  const db = await getDB();
  return db.get(STORE, id);
}

export async function putNote(note) {
  const db = await getDB();
  await db.put(STORE, note);
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

export async function wipeAll() {
  const db = await getDB();
  await db.clear(STORE);
}

/**
 * Return notes that are not soft-deleted, newest first.
 * For M2, uses the `updatedAt` index and filters deleted in JS.
 * (When trash ships in M5, we'll add a compound index.)
 */
export async function listActiveNotes() {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE, 'updatedAt');
  return all
    .filter((n) => !n.deletedAt)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}


export async function softDeleteNote(id) {
  const db = await getDB();
  const note = await db.get(STORE, id);
  if (!note) return;
  note.deletedAt = new Date().toISOString();
  note.updatedAt = note.deletedAt;
  await db.put(STORE, note);
}


export async function restoreNote(id) {
  const db = await getDB();
  const note = await db.get(STORE, id);
  if (!note) return;
  note.deletedAt = null;
  note.updatedAt = new Date().toISOString();
  await db.put(STORE, note);
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
 * Permanently remove a note (used by "Delete forever" in the trash view).
 */
export async function purgeNote(id) {
  const db = await getDB();
  await db.delete(STORE, id);
}

/**
 * Permanently remove every soft-deleted note.
 * Returns the count purged.
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
 * Total number of notes (for storage estimation in settings).
 */
export async function storageStats() {
  const db = await getDB();
  const all = await db.getAll(STORE);
  const active = all.filter((n) => !n.deletedAt).length;
  const trash = all.filter((n) => !!n.deletedAt).length;
  const bytes = new Blob([JSON.stringify(all)]).size;
  return { total: all.length, active, trash, bytes };
}