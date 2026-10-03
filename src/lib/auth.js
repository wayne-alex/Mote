// src/lib/auth.js
import { writable, get } from 'svelte/store';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from './firebase.js';

const EMAIL_LINK_KEY = 'mote:emailForSignIn';

// ── Observable state ─────────────────────────────────────────
export const authUser = writable(null);
export const authReady = writable(false);
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

/**
 * Sign in with Google.
 *
 * In production (HTTPS, non-localhost), we use signInWithRedirect
 * because popups are frequently blocked by browsers and COOP
 * policies. In dev on localhost, we use signInWithPopup because
 * it's faster and localhost doesn't have the same restrictions.
 *
 * Returns the signed-in user, OR null if a redirect was initiated
 * (in which case the page is about to reload).
 */
export async function signInWithGoogle() {
  authError.set(null);

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
     window.location.hostname === '127.0.0.1');

  if (isLocalhost) {
    // Dev: try popup, fall back to redirect if blocked
    try {
      const result = await signInWithPopup(auth, provider);
      return result.user;
    } catch (err) {
      if (err?.code === 'auth/popup-blocked' ||
          err?.code === 'auth/popup-closed-by-user') {
        console.warn('[auth] popup blocked in dev, falling back to redirect');
        await signInWithRedirect(auth, provider);
        return null;   // page will reload
      }
      console.error('[auth] google sign-in failed:', err);
      authError.set(friendlyError(err));
      throw err;
    }
  }

  // Production: always use redirect
  try {
    await signInWithRedirect(auth, provider);
    return null;   // page will reload; getRedirectResult() picks it up
  } catch (err) {
    console.error('[auth] google redirect failed:', err);
    authError.set(friendlyError(err));
    throw err;
  }
}

/**
 * Called once on app boot. If the page just came back from a
 * Google sign-in redirect, this resolves the result.
 *
 * Returns the signed-in user, or null if there was no redirect
 * to process.
 */
export async function completeRedirectSignIn() {
  try {
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch (err) {
    // A few errors here are expected and harmless:
    //   - auth/no-auth-event: the user landed on the page normally
    //   - auth/popup-blocked: transitive from an older attempt
    if (err?.code === 'auth/no-auth-event') return null;
    console.error('[auth] redirect completion failed:', err);
    authError.set(friendlyError(err));
    return null;
  }
}

// ── Sign in with email link ──────────────────────────────────

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

export async function completeEmailLinkSignIn() {
  if (!isSignInWithEmailLink(auth, window.location.href)) return null;

  let email = localStorage.getItem(EMAIL_LINK_KEY);
  if (!email) {
    email = window.prompt('Confirm the email you used to request this link:');
    if (!email) return null;
  }

  try {
    const result = await signInWithEmailLink(auth, email, window.location.href);
    localStorage.removeItem(EMAIL_LINK_KEY);
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
  if (code === 'auth/popup-blocked') return 'Your browser blocked the sign-in window. Redirecting…';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection.';
  if (code === 'auth/invalid-email') return 'That email address looks invalid.';
  if (code === 'auth/unauthorized-domain') {
    return 'This domain isn\'t authorized for sign-in. Add it in Firebase Console → Authentication → Settings → Authorized domains.';
  }
  if (code === 'auth/cancelled-popup-request') return 'Sign-in was cancelled.';
  if (code === 'auth/operation-not-supported-in-this-environment') {
    return 'Sign-in requires HTTPS. Open the app over a secure connection.';
  }
  return err?.message || 'Something went wrong. Try again.';
}