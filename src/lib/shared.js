// src/lib/shared.js
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db as firestore } from './firebase.js';
import { authUser } from './auth.js';
import { get } from 'svelte/store';
import { uuid } from './notes.js';

// ═══════════════════════════════════════════════════════════
// TOKEN
// ═══════════════════════════════════════════════════════════

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function shareUrlFor(token) {
  return `${window.location.origin}/s/${token}`;
}

// ═══════════════════════════════════════════════════════════
// CREATE
// ═══════════════════════════════════════════════════════════

export async function createSharedList({ listStyle = 'todo', title = '' } = {}) {
  const user = get(authUser);
  if (!user) throw new Error('Sign in to create shared lists.');

  const token = generateToken();
  const now = new Date().toISOString();

  const payload = {
    ownerId: user.uid,
    kind: 'list',
    listStyle,
    title,
    items: [],
    members: [user.uid],
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(firestore, 'shared', token), payload);

  return { token, payload };
}

// ═══════════════════════════════════════════════════════════
// READ
// ═══════════════════════════════════════════════════════════

export async function fetchSharedList(token) {
  if (!token) return null;
  const snap = await getDoc(doc(firestore, 'shared', token));
  return snap.exists() ? { token, ...snap.data() } : null;
}

/**
 * Subscribe to real-time updates. Returns an unsubscribe function.
 * Callback fires immediately with the current state, then on every change.
 */
export function watchSharedList(token, callback) {
  if (!token) return () => {};
  const ref = doc(firestore, 'shared', token);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        callback(null);
        return;
      }
      callback({ token, ...snap.data() });
    },
    (err) => {
      console.error('[shared] snapshot error:', err);
      callback(null);
    }
  );
}

// ═══════════════════════════════════════════════════════════
// WRITE — any member can edit items, title, listStyle
// ═══════════════════════════════════════════════════════════

export async function updateSharedList(token, patch) {
  const user = get(authUser);
  if (!user) throw new Error('Sign in to edit shared lists.');

  const ref = doc(firestore, 'shared', token);
  await setDoc(
    ref,
    {
      ...patch,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function addItemToShared(token, text = '') {
  const current = await fetchSharedList(token);
  if (!current) throw new Error('Shared list not found.');

  const items = [...(current.items || []), {
    id: uuid(),
    text,
    done: false,
    doneAt: null,
  }];

  await updateSharedList(token, { items });
}

export async function removeItemFromShared(token, itemId) {
  const current = await fetchSharedList(token);
  if (!current) return;
  const items = (current.items || []).filter((it) => it.id !== itemId);
  await updateSharedList(token, { items });
}

export async function toggleItemInShared(token, itemId) {
  const current = await fetchSharedList(token);
  if (!current) return;
  const items = (current.items || []).map((it) =>
    it.id === itemId
      ? { ...it, done: !it.done, doneAt: !it.done ? new Date().toISOString() : null }
      : it
  );
  await updateSharedList(token, { items });
}

export async function updateItemTextInShared(token, itemId, text) {
  const current = await fetchSharedList(token);
  if (!current) return;
  const items = (current.items || []).map((it) =>
    it.id === itemId ? { ...it, text } : it
  );
  await updateSharedList(token, { items });
}

export async function updateSharedTitle(token, title) {
  await updateSharedList(token, { title });
}

// ═══════════════════════════════════════════════════════════
// JOIN — add self to members if not already there
// ═══════════════════════════════════════════════════════════

export async function joinSharedList(token) {
  const user = get(authUser);
  if (!user) return false;

  const current = await fetchSharedList(token);
  if (!current) return false;

  if ((current.members || []).includes(user.uid)) return true;

  const ref = doc(firestore, 'shared', token);
  await setDoc(
    ref,
    {
      members: [...(current.members || []), user.uid],
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  return true;
}

// ═══════════════════════════════════════════════════════════
// REVOKE / DELETE
// ═══════════════════════════════════════════════════════════

export async function deleteSharedList(token) {
  await deleteDoc(doc(firestore, 'shared', token));
}

// ═══════════════════════════════════════════════════════════
// ROUTING
// ═══════════════════════════════════════════════════════════

export function getSharedTokenFromPath(path = window.location.pathname) {
  const m = path.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/);
  return m ? m[1] : null;
}