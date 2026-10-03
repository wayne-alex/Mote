// src/lib/auth.js
import { writable } from 'svelte/store';
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
import { clearAllDeviceKeys } from './key-vault.js';

const EMAIL_LINK_KEY = 'mote:emailForSignIn';

// ── Observable state ─────────────────────────────────────────
export const authUser = writable(null);
export const authReady = writable(false);
export const authError = writable(null);

let unsubscribe = null;
let redirectPromise = null;

/**
 * Start observing auth state. Call once at app boot.
 *
 * authReady only becomes true after any pending Google redirect has been
 * resolved, so the UI never flashes "signed out" while a redirect
 * sign-in is still being completed.
 */
export function initAuth() {
  if (unsubscribe) return;

  const redirectDone = completeRedirectSignIn();

  unsubscribe = onAuthStateChanged(
    auth,
    async (user) => {
      authUser.set(user);
      if (user) authError.set(null);
      await redirectDone;
      authReady.set(true);
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
 * Popup first: it works on every host without extra configuration.
 * Redirect is only the fallback, for browsers that block popups or
 * can't open them (for example an installed iOS PWA).
 *
 * Returns the signed-in user, or null if a redirect was started (the
 * page is about to navigate away). Throws if the user cancels.
 */
export async function signInWithGoogle() {
  authError.set(null);

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (err) {
    const code = err?.code || '';

    const shouldRedirect =
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment';

    if (shouldRedirect) {
      try {
        localStorage.setItem('mote:signinPending', '1');
        await signInWithRedirect(auth, provider);
        return null;
      } catch (redirectErr) {
        localStorage.removeItem('mote:signinPending');
        console.error('[auth] google redirect failed:', redirectErr);
        authError.set(friendlyError(redirectErr));
        throw redirectErr;
      }
    }

    // Cancelled by the user, network error, unauthorised domain, etc.
    if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
      console.error('[auth] google sign-in failed:', err);
    }
    authError.set(friendlyError(err));
    throw err;
  }
}

/**
 * Resolves the result of a Google redirect sign-in, if the page just
 * came back from one. Safe to call more than once: the work is done
 * a single time and later calls get the same result.
 */
export function completeRedirectSignIn() {
  if (!redirectPromise) {
    redirectPromise = (async () => {
      try {
        const result = await getRedirectResult(auth);
        return result?.user || null;
      } catch (err) {
        if (err?.code === 'auth/no-auth-event') return null;
        console.error('[auth] redirect completion failed:', err);
        authError.set(friendlyError(err));
        return null;
      } finally {
        localStorage.removeItem('mote:signinPending');
      }
    })();
  }
  return redirectPromise;
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
  // Forget the auto-unlock key first: signing out means the next
  // sign-in on this device must supply the recovery phrase again.
  await clearAllDeviceKeys();
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