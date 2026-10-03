// src/lib/sync.js
import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  writeBatch,
  onSnapshot,
} from 'firebase/firestore';
import { db as firestore } from './firebase.js';
import { encryptObject, decryptObject } from './crypto.js';
import {
  listAllNotes,
  getNote,
  upsertNote,
  bulkUpsertNotes,
} from './db.js';

// ═══════════════════════════════════════════════════════════
// PATHS
// ═══════════════════════════════════════════════════════════
function profileRef(uid) {
  return doc(firestore, 'users', uid);
}
function noteRef(uid, noteId) {
  return doc(firestore, 'users', uid, 'notes', noteId);
}
function notesCollection(uid) {
  return collection(firestore, 'users', uid, 'notes');
}

// ═══════════════════════════════════════════════════════════
// ENCRYPT / DECRYPT HELPERS
// ═══════════════════════════════════════════════════════════

function stripForEncryption(note) {
  const {
    updatedAt, createdAt, deletedAt,
    ownerId, sharedWith,
    ...content
  } = note;
  return content;
}

function rebuildFromDecryption(content, meta) {
  return {
    ...content,
    updatedAt: meta.updatedAt,
    deletedAt: meta.deletedAt || null,
    createdAt: content.createdAt || meta.createdAt || meta.updatedAt,
    ownerId: null,
    sharedWith: [],
  };
}

// ═══════════════════════════════════════════════════════════
// UPLOAD
// ═══════════════════════════════════════════════════════════

export async function uploadNote(uid, key, note) {
  const content = stripForEncryption(note);
  const { ciphertext, iv } = await encryptObject(content, key);

  await setDoc(noteRef(uid, note.id), {
    ciphertext,
    iv,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt || null,
    syncedAt: serverTimestamp(),
  });

  return note.updatedAt;
}

export async function uploadManyNotes(uid, key, notes) {
  if (!notes.length) return { uploaded: 0 };

  const CHUNK = 400;
  let uploaded = 0;

  for (let i = 0; i < notes.length; i += CHUNK) {
    const batch = writeBatch(firestore);
    const chunk = notes.slice(i, i + CHUNK);

    for (const note of chunk) {
      const content = stripForEncryption(note);
      const { ciphertext, iv } = await encryptObject(content, key);
      batch.set(noteRef(uid, note.id), {
        ciphertext,
        iv,
        updatedAt: note.updatedAt,
        deletedAt: note.deletedAt || null,
        syncedAt: serverTimestamp(),
      });
      uploaded++;
    }

    await batch.commit();
  }

  return { uploaded };
}

// ═══════════════════════════════════════════════════════════
// DOWNLOAD
// ═══════════════════════════════════════════════════════════

async function fetchAllRemote(uid) {
  const snap = await getDocs(notesCollection(uid));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function fetchRemoteSince(uid, sinceIso) {
  const q = query(
    notesCollection(uid),
    where('updatedAt', '>', sinceIso),
    orderBy('updatedAt')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function fetchRemoteMeta(uid, noteId) {
  const snap = await getDoc(noteRef(uid, noteId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ═══════════════════════════════════════════════════════════
// RECONCILE
// ═══════════════════════════════════════════════════════════

export async function reconcile(uid, key) {
  const result = { pushed: 0, pulled: 0, deleted: 0, unchanged: 0, errors: [] };

  const [localNotes, remoteDocs] = await Promise.all([
    listAllNotes(),
    fetchAllRemote(uid),
  ]);

  const localById = new Map(localNotes.map((n) => [n.id, n]));
  const remoteById = new Map(remoteDocs.map((r) => [r.id, r]));

  const toPush = [];
  const toPull = [];

  for (const [id, local] of localById) {
    const remote = remoteById.get(id);

    if (!remote) {
      toPush.push(local);
      continue;
    }

    const localTime = Date.parse(local.updatedAt || 0);
    const remoteTime = Date.parse(remote.updatedAt || 0);

    if (localTime > remoteTime) toPush.push(local);
    else if (remoteTime > localTime) toPull.push(remote);
    else result.unchanged++;
  }

  for (const [id, remote] of remoteById) {
    // A remote tombstone for a note we don't have locally was purged here
    // on purpose. Pulling it would bring it back into the trash.
    if (!localById.has(id) && !remote.deletedAt) toPull.push(remote);
  }

  if (toPull.length > 0) {
    const decrypted = [];
    for (const remote of toPull) {
      try {
        const content = await decryptObject(remote.ciphertext, remote.iv, key);
        const note = rebuildFromDecryption(content, {
          updatedAt: remote.updatedAt,
          deletedAt: remote.deletedAt || null,
          createdAt: content.createdAt,
        });
        decrypted.push(note);
      } catch (err) {
        console.error(`[sync] failed to decrypt remote note ${remote.id}:`, err);
        result.errors.push({ id: remote.id, err: err.message });
      }
    }

    if (decrypted.length > 0) {
      await bulkUpsertNotes(decrypted);
      result.pulled = decrypted.length;
      result.deleted += decrypted.filter((n) => n.deletedAt).length;
    }
  }

  if (toPush.length > 0) {
    try {
      const { uploaded } = await uploadManyNotes(uid, key, toPush);
      result.pushed = uploaded;
    } catch (err) {
      console.error('[sync] bulk upload failed:', err);
      result.errors.push({ phase: 'upload', err: err.message });
    }
  }

  await setDoc(
    profileRef(uid),
    { lastSyncedAt: serverTimestamp() },
    { merge: true }
  );

  return result;
}

// ═══════════════════════════════════════════════════════════
// INCREMENTAL
// ═══════════════════════════════════════════════════════════

export async function incrementalSync(uid, key, sinceIso) {
  const result = { pushed: 0, pulled: 0, unchanged: 0, errors: [] };

  const [localNotes, remoteDocs] = await Promise.all([
    listAllNotes(),
    fetchRemoteSince(uid, sinceIso),
  ]);

  const localById = new Map(localNotes.map((n) => [n.id, n]));

  const toPull = [];
  for (const remote of remoteDocs) {
    const local = localById.get(remote.id);
    if (!local) { toPull.push(remote); continue; }
    const localTime = Date.parse(local.updatedAt || 0);
    const remoteTime = Date.parse(remote.updatedAt || 0);
    if (remoteTime > localTime) toPull.push(remote);
    else result.unchanged++;
  }

  if (toPull.length > 0) {
    const decrypted = [];
    for (const remote of toPull) {
      try {
        const content = await decryptObject(remote.ciphertext, remote.iv, key);
        decrypted.push(rebuildFromDecryption(content, {
          updatedAt: remote.updatedAt,
          deletedAt: remote.deletedAt || null,
        }));
      } catch (err) {
        result.errors.push({ id: remote.id, err: err.message });
      }
    }
    if (decrypted.length > 0) {
      await bulkUpsertNotes(decrypted);
      result.pulled = decrypted.length;
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// REALTIME
// ═══════════════════════════════════════════════════════════

/**
 * Apply a batch of remote docs to local storage. Only docs that are
 * newer than the local copy are written. bulkUpsertNotes does not fire
 * save listeners, so applying remote changes never triggers a push.
 * Returns how many notes were written.
 */
async function applyRemoteDocs(key, remoteDocs) {
  const decrypted = [];

  for (const remote of remoteDocs) {
    const local = await getNote(remote.id);

    // Never resurrect a tombstone for a note purged on this device
    if (!local && remote.deletedAt) continue;

    if (local) {
      const localTime = Date.parse(local.updatedAt || 0);
      const remoteTime = Date.parse(remote.updatedAt || 0);
      if (remoteTime <= localTime) continue;
    }

    try {
      const content = await decryptObject(remote.ciphertext, remote.iv, key);
      decrypted.push(rebuildFromDecryption(content, {
        updatedAt: remote.updatedAt,
        deletedAt: remote.deletedAt || null,
      }));
    } catch (err) {
      console.error(`[sync] realtime decrypt failed for ${remote.id}:`, err);
    }
  }

  if (decrypted.length > 0) await bulkUpsertNotes(decrypted);
  return decrypted.length;
}

/**
 * Live subscription to users/{uid}/notes. Fires whenever another
 * device adds or edits a note. Returns an unsubscribe function.
 *
 * The first snapshot contains every remote note; applyRemoteDocs skips
 * anything that is not newer than the local copy, so it is cheap.
 */
export function watchRemoteNotes(uid, key, { onApplied, onError } = {}) {
  let chain = Promise.resolve();

  return onSnapshot(
    notesCollection(uid),
    (snap) => {
      const docs = snap
        .docChanges()
        .filter((c) => c.type !== 'removed')
        // Skip our own writes that have not reached the server yet
        .filter((c) => !c.doc.metadata.hasPendingWrites)
        .map((c) => ({ id: c.doc.id, ...c.doc.data() }));

      if (docs.length === 0) return;

      chain = chain
        .then(() => applyRemoteDocs(key, docs))
        .then((count) => { if (count > 0) onApplied?.(count); })
        .catch((err) => console.error('[sync] realtime apply failed:', err));
    },
    (err) => {
      console.error('[sync] realtime listener error:', err);
      onError?.(err);
    }
  );
}

// ═══════════════════════════════════════════════════════════
// PER-NOTE
// ═══════════════════════════════════════════════════════════

export async function pushNote(uid, key, noteId) {
  const note = await getNote(noteId);
  if (!note) return null;
  return uploadNote(uid, key, note);
}

export async function pullNote(uid, key, noteId) {
  const remote = await fetchRemoteMeta(uid, noteId);
  if (!remote) return false;

  const local = await getNote(noteId);
  const remoteTime = Date.parse(remote.updatedAt || 0);
  const localTime = local ? Date.parse(local.updatedAt || 0) : 0;

  if (remoteTime <= localTime) return false;

  try {
    const content = await decryptObject(remote.ciphertext, remote.iv, key);
    const note = rebuildFromDecryption(content, {
      updatedAt: remote.updatedAt,
      deletedAt: remote.deletedAt || null,
    });
    await upsertNote(note);
    return true;
  } catch (err) {
    console.error(`[sync] pullNote failed for ${noteId}:`, err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// WIPE REMOTE — permanently delete the whole account
// ═══════════════════════════════════════════════════════════

/**
 * Delete every note under users/{uid}/notes and the users/{uid}
 * profile document itself. Used by "Start fresh".
 *
 * This is the point of no return — the encrypted cloud copy
 * is gone forever. Local data is NOT touched here; the caller
 * is responsible for wiping IndexedDB too.
 *
 * Must be called while the user is still signed in — Firestore
 * rules require auth to write to their own paths.
 */
export async function wipeRemoteAccount(uid) {
  // Delete every note document in batches
  const notesSnap = await getDocs(notesCollection(uid));
  const docs = notesSnap.docs;
  const CHUNK = 400;

  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(firestore);
    const slice = docs.slice(i, i + CHUNK);
    for (const d of slice) batch.delete(d.ref);
    await batch.commit();
  }

  // Delete the profile document
  await deleteDoc(profileRef(uid));

  return { notesDeleted: docs.length };
}