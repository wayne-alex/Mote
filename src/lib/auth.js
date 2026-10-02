// src/lib/auth.js
import { writable } from 'svelte/store';
import {
  GoogleAuthProvider,
  signInWithPopup,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from './firebase.js';

const EMAIL_LINK_KEY = 'mote:emailForSignIn';

// ── Observable state ─────────────────────────────────────────
export const authUser = writable(null);       // Firebase User | null
export const authReady = writable(false);     // true once initial state is known
export const authError = writable(null);

let unsubscribe = null;

/**
 * Start observing auth state. Call once at app boot.
 */
export function initAuth() {
  if (unsubscribe) return;
  unsubscribe = onAuthStateChanged(
    auth,
    (user) => {
      authUser.set(user);
      authReady.set(true);
      authError.set(null);
    },
    (err) => {
      console.error('[auth] state error:', err);
      authError.set(err.message || 'Auth error');
      authReady.set(true);
    }
  );
}

// ── Sign in with Google ──────────────────────────────────────
export async function signInWithGoogle() {
  authError.set(null);
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (err) {
    console.error('[auth] google sign-in failed:', err);
    authError.set(friendlyError(err));
    throw err;
  }
}

// ── Sign in with email link ──────────────────────────────────
/**
 * Send the magic link. Stores the email locally so we can
 * complete the sign-in when the user clicks the link.
 */
export async function sendEmailLink(email, returnUrl) {
  authError.set(null);
  if (!email || !email.includes('@')) {
    const msg = 'Enter a valid email address.';
    authError.set(msg);
    throw new Error(msg);
  }

  const actionCodeSettings = {
    url: returnUrl || window.location.origin,
    handleCodeInApp: true,
  };

  try {
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    localStorage.setItem(EMAIL_LINK_KEY, email);
    return true;
  } catch (err) {
    console.error('[auth] email link failed:', err);
    authError.set(friendlyError(err));
    throw err;
  }
}

/**
 * Called on app boot. If the current URL is a sign-in link,
 * complete the sign-in using the stored email.
 */
export async function completeEmailLinkSignIn() {
  if (!isSignInWithEmailLink(auth, window.location.href)) return null;

  let email = localStorage.getItem(EMAIL_LINK_KEY);
  if (!email) {
    // Prompt the user for their email if we don't have it stored
    email = window.prompt('Confirm the email you used to request this link:');
    if (!email) return null;
  }

  try {
    const result = await signInWithEmailLink(auth, email, window.location.href);
    localStorage.removeItem(EMAIL_LINK_KEY);
    // Clean the URL so the link params don't linger
    window.history.replaceState({}, '', '/');
    return result.user;
  } catch (err) {
    console.error('[auth] email link completion failed:', err);
    authError.set(friendlyError(err));
    throw err;
  }
}

// ── Sign out ─────────────────────────────────────────────────
export async function signOutNow() {
  try {
    await fbSignOut(auth);
  } catch (err) {
    console.error('[auth] sign out failed:', err);
  }
}

// ── Helpers ──────────────────────────────────────────────────
function friendlyError(err) {
  const code = err?.code || '';
  if (code === 'auth/popup-closed-by-user') return 'Sign-in cancelled.';
  if (code === 'auth/popup-blocked') return 'Pop-up was blocked. Allow pop-ups for this site and try again.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection.';
  if (code === 'auth/invalid-email') return 'That email address looks invalid.';
  if (code === 'auth/unauthorized-domain') return 'This domain isn\'t authorized for sign-in. Ask the developer to add it in Firebase Console.';
  return err?.message || 'Something went wrong. Try again.';
}