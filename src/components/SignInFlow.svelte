<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import {
    authUser,
    signInWithGoogle,
    sendEmailLink,
  } from '../lib/auth.js';
  import {
    generateRecoveryPhrase,
    generateSalt,
    deriveKey,
    buildVerifier,
    checkVerifier,
    normalizePhrase,
  } from '../lib/crypto.js';
  import { setSyncKey } from '../lib/sync-key.js';
  import {
    wrapAndStoreKey,
    isBiometricAvailable,
  } from '../lib/key-vault.js';
  import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
  } from 'firebase/firestore';
  import { db as firestore } from '../lib/firebase.js';

  const dispatch = createEventDispatcher();

  // ═══════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════
  let screen = 'loading';
  // 'loading' | 'method' | 'email' | 'email-sent' | 'setup-phrase'
  // | 'confirm-phrase' | 'enter-phrase' | 'biometric' | 'done' | 'error'

  let errorMsg = '';
  let busy = false;

  let emailInput = '';

  let generatedPhrase = '';
  let phraseConfirmed = '';
  let phraseConfirmError = '';

  let enteredPhrase = '';
  let phraseEntryError = '';

  let salt = '';
  let derivedKey = null;

  let showLostPhraseHelp = false;

  // ═══════════════════════════════════════════════════════════
  // BOOT
  // ═══════════════════════════════════════════════════════════
  onMount(async () => {
    if (!$authUser) {
      screen = 'method';
      return;
    }
    await resolveSignedInScreen($authUser);
  });

  $: if ($authUser && screen === 'method') {
    resolveSignedInScreen($authUser);
  }

  async function resolveSignedInScreen(user) {
    screen = 'loading';
    try {
      const profileRef = doc(firestore, 'users', user.uid);
      const profileSnap = await getDoc(profileRef);

      if (!profileSnap.exists()) {
        screen = 'setup-phrase';
        generatedPhrase = generateRecoveryPhrase();
        salt = generateSalt();
        return;
      }

      const profile = profileSnap.data();
      if (!profile.verifier) {
        screen = 'setup-phrase';
        generatedPhrase = generateRecoveryPhrase();
        salt = generateSalt();
        return;
      }

      salt = profile.salt;
      screen = 'enter-phrase';
    } catch (err) {
      console.error('[signin] resolve failed:', err);
      errorMsg = err.message || 'Could not load your account.';
      screen = 'error';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SIGN IN
  // ═══════════════════════════════════════════════════════════
  async function doGoogleSignIn() {
    busy = true;
    errorMsg = '';
    try {
      await signInWithGoogle();
    } catch (err) {
      errorMsg = err.message || 'Sign-in failed.';
    } finally {
      busy = false;
    }
  }

  async function doEmailSubmit() {
    busy = true;
    errorMsg = '';
    try {
      await sendEmailLink(emailInput, window.location.href);
      screen = 'email-sent';
    } catch (err) {
      errorMsg = err.message || 'Could not send the link.';
    } finally {
      busy = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PHRASE SETUP (first device)
  // ═══════════════════════════════════════════════════════════
  async function copyPhrase() {
    try {
      await navigator.clipboard.writeText(generatedPhrase);
    } catch {}
  }

  function downloadPhrase() {
    const blob = new Blob(
      [
        'Mote recovery phrase\n',
        '====================\n\n',
        generatedPhrase,
        '\n\n',
        'Save this somewhere safe. If you lose it, your notes cannot be recovered.\n',
        'Created: ' + new Date().toISOString() + '\n',
      ],
      { type: 'text/plain' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mote-recovery-phrase.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function confirmPhrase() {
    const words = generatedPhrase.split('-').slice(0, 2).join('-');
    const entered = normalizePhrase(phraseConfirmed);

    if (entered !== words) {
      phraseConfirmError = 'That doesn\'t match. Type the first two words exactly.';
      return;
    }
    phraseConfirmError = '';
    await finishPhraseSetup();
  }

  async function finishPhraseSetup() {
    busy = true;
    errorMsg = '';
    try {
      derivedKey = await deriveKey(generatedPhrase, salt);
      const verifier = await buildVerifier(derivedKey);

      await setDoc(
        doc(firestore, 'users', $authUser.uid),
        {
          salt,
          verifier,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      if (isBiometricAvailable()) {
        screen = 'biometric';
      } else {
        completeSetup();
      }
    } catch (err) {
      console.error('[signin] phrase setup failed:', err);
      errorMsg = err.message || 'Could not set up your phrase.';
    } finally {
      busy = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PHRASE ENTRY (second device)
  // ═══════════════════════════════════════════════════════════
  async function submitPhrase() {
    busy = true;
    phraseEntryError = '';
    try {
      const phrase = normalizePhrase(enteredPhrase);
      const key = await deriveKey(phrase, salt);

      const profileSnap = await getDoc(doc(firestore, 'users', $authUser.uid));
      const profile = profileSnap.data();
      if (!profile?.verifier) throw new Error('Account is missing its verifier.');

      const ok = await checkVerifier(profile.verifier, key);
      if (!ok) {
        phraseEntryError = 'That phrase doesn\'t match this account. Try again.';
        return;
      }

      derivedKey = key;

      if (isBiometricAvailable()) {
        screen = 'biometric';
      } else {
        completeSetup(phrase);
      }
    } catch (err) {
      console.error('[signin] phrase verification failed:', err);
      phraseEntryError = err.message || 'Could not verify the phrase.';
    } finally {
      busy = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // BIOMETRIC
  // ═══════════════════════════════════════════════════════════
  async function enableBiometric() {
    busy = true;
    try {
      await wrapAndStoreKey($authUser.uid, derivedKey);
      completeSetup();
    } catch (err) {
      console.error('[signin] biometric enable failed:', err);
      completeSetup();
    } finally {
      busy = false;
    }
  }

  function skipBiometric() {
    completeSetup();
  }

  // ═══════════════════════════════════════════════════════════
  // RECOVERY HELP — wipe remote + local, sign out, close
  // ═══════════════════════════════════════════════════════════
  async function handleStartFresh() {
    showLostPhraseHelp = false;

    const confirmed = window.confirm(
      'This permanently deletes your cloud notes and signs you out. ' +
      'Your notes on this device will also be removed. This cannot be undone. Continue?'
    );
    if (!confirmed) return;

    busy = true;
    errorMsg = '';

    try {
      const { wipeAll } = await import('../lib/db.js');
      const { signOutNow } = await import('../lib/auth.js');
      const { clearSyncKey } = await import('../lib/sync-key.js');
      const { wipeRemoteAccount } = await import('../lib/sync.js');

      const uid = $authUser?.uid;

      if (uid) {
        // Delete every note document and the profile document.
        // This must happen while still signed in — Firestore rules
        // require auth to write to our own paths.
        await wipeRemoteAccount(uid);
      }

      // Then wipe local state and sign out.
      await wipeAll();
      clearSyncKey();
      await signOutNow();

      // Close the overlay. The parent (App.svelte) sets showSignInFlow
      // to false, and the user lands back on their (now empty) notes list.
      dispatch('close');
    } catch (err) {
      console.error('[signin] start fresh failed:', err);
      errorMsg = err.message || 'Could not reset. Try again.';
      screen = 'error';
    } finally {
      busy = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FINISH
  // ═══════════════════════════════════════════════════════════
  function completeSetup(phrase = null) {
    setSyncKey({
      key: derivedKey,
      salt,
      phrase,
    });
    dispatch('complete', { key: derivedKey, salt });
    screen = 'done';
    setTimeout(() => dispatch('close'), 600);
  }

  function cancel() {
    if (screen === 'done') return;
    dispatch('close');
  }
</script>

<div class="flow">
  <button class="close-btn" on:click={cancel} aria-label="Close" disabled={screen === 'done'}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 6 L18 18 M18 6 L6 18"/>
    </svg>
  </button>

  <div class="content">

    <!-- ══════════════ LOADING ══════════════ -->
    {#if screen === 'loading'}
      <div class="center">
        <div class="spinner"></div>
        <p class="muted">Loading…</p>
      </div>

    <!-- ══════════════ CHOOSE METHOD ══════════════ -->
    {:else if screen === 'method'}
      <div class="panel">
        <div class="logo">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
               stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="4"/>
          </svg>
        </div>
        <h1>Sync across devices</h1>
        <p class="lede">
          Your notes will be <strong>encrypted on this device</strong> before they're uploaded.
          Even we can't read them.
        </p>

        <div class="actions">
          <button class="method-btn google" on:click={doGoogleSignIn} disabled={busy}>
            <svg viewBox="0 0 48 48" width="18" height="18">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
          </button>

          <button class="method-btn email" on:click={() => (screen = 'email')} disabled={busy}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2"/>
              <path d="M3 7 L12 13 L21 7"/>
            </svg>
            Sign in with email
          </button>
        </div>

        {#if errorMsg}
          <div class="error">{errorMsg}</div>
        {/if}

        <p class="fine-print">
          By continuing you agree that if you lose your recovery phrase,
          we cannot recover your notes.
        </p>
      </div>

    <!-- ══════════════ EMAIL ENTRY ══════════════ -->
    {:else if screen === 'email'}
      <div class="panel">
        <button class="back-btn" on:click={() => (screen = 'method')}>← Back</button>
        <h1>Enter your email</h1>
        <p class="lede">
          We'll send you a link. Click it and you'll be signed in — no password needed.
        </p>

        <input
          type="email"
          bind:value={emailInput}
          placeholder="you@example.com"
          autocomplete="email"
          inputmode="email"
        />

        <div class="actions">
          <button class="primary" on:click={doEmailSubmit} disabled={busy || !emailInput.trim()}>
            {busy ? 'Sending…' : 'Send link'}
          </button>
        </div>

        {#if errorMsg}
          <div class="error">{errorMsg}</div>
        {/if}
      </div>

    <!-- ══════════════ EMAIL SENT ══════════════ -->
    {:else if screen === 'email-sent'}
      <div class="panel center-text">
        <div class="big-icon">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor"
               stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2"/>
            <path d="M3 7 L12 13 L21 7"/>
          </svg>
        </div>
        <h1>Check your inbox</h1>
        <p class="lede">
          We sent a sign-in link to <strong>{emailInput}</strong>.
          Open it on this device to continue.
        </p>
      </div>

    <!-- ══════════════ SETUP PHRASE ══════════════ -->
    {:else if screen === 'setup-phrase'}
      <div class="panel">
        <h1>Save your recovery phrase</h1>
        <p class="lede">
          This is the only way to unlock your notes on another device.
          Write it down somewhere safe.
        </p>

        <div class="phrase-box">
          {#each generatedPhrase.split('-') as word, i}
            <span class="phrase-word">
              <span class="word-num">{i + 1}</span>
              {word}
            </span>
          {/each}
        </div>

        <div class="phrase-actions">
          <button class="ghost" on:click={copyPhrase}>Copy</button>
          <button class="ghost" on:click={downloadPhrase}>Save as file</button>
        </div>

        <div class="warning">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3 L2 20 H22 Z M12 10 V14 M12 17 V17.5"/>
          </svg>
          If you lose this phrase, your notes cannot be recovered.
        </div>

        <div class="actions">
          <button class="primary" on:click={() => (screen = 'confirm-phrase')}>
            I've saved it — continue
          </button>
        </div>
      </div>

    <!-- ══════════════ CONFIRM PHRASE ══════════════ -->
    {:else if screen === 'confirm-phrase'}
      <div class="panel">
        <h1>Type the first two words</h1>
        <p class="lede">
          Just to make sure you've saved it.
        </p>

        <input
          type="text"
          bind:value={phraseConfirmed}
          placeholder="word1-word2"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          autocapitalize="off"
        />

        {#if phraseConfirmError}
          <div class="error">{phraseConfirmError}</div>
        {/if}

        <div class="actions">
          <button
            class="primary"
            on:click={confirmPhrase}
            disabled={busy || !phraseConfirmed.trim()}
          >
            {busy ? 'Setting up…' : 'Continue'}
          </button>
          <button class="ghost" on:click={() => (screen = 'setup-phrase')}>
            Show phrase again
          </button>
        </div>
      </div>

    <!-- ══════════════ ENTER PHRASE ══════════════ -->
    {:else if screen === 'enter-phrase'}
      <div class="panel">
        <h1>Enter your recovery phrase</h1>
        <p class="lede">
          Type the 6 words you saved when you first set up Mote.
          You can use spaces or hyphens.
        </p>

        <input
          type="text"
          bind:value={enteredPhrase}
          placeholder="word1 word2 word3 word4 word5 word6"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          autocapitalize="off"
        />

        {#if phraseEntryError}
          <div class="error">{phraseEntryError}</div>
        {/if}

        <div class="actions">
          <button
            class="primary"
            on:click={submitPhrase}
            disabled={busy || !enteredPhrase.trim()}
          >
            {busy ? 'Verifying…' : 'Unlock my notes'}
          </button>
        </div>

        <button class="link-btn" on:click={() => (showLostPhraseHelp = true)}>
          I don't have my recovery phrase
        </button>
      </div>

    <!-- ══════════════ BIOMETRIC ══════════════ -->
    {:else if screen === 'biometric'}
      <div class="panel center-text">
        <div class="big-icon accent">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor"
               stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 11 V15 M12 6 C15 6 17 8 17 11 V15 C17 19 15 21 12 21 C9 21 7 19 7 15 V11 C7 8 9 6 12 6 Z"/>
            <path d="M9 3 H15"/>
          </svg>
        </div>
        <h1>Unlock with biometrics</h1>
        <p class="lede">
          Use Face ID, Touch ID, or Windows Hello to unlock Mote next time —
          instead of typing your phrase.
        </p>

        <div class="actions">
          <button class="primary" on:click={enableBiometric} disabled={busy}>
            {busy ? 'Setting up…' : 'Enable'}
          </button>
          <button class="ghost" on:click={skipBiometric} disabled={busy}>
            Not now
          </button>
        </div>
      </div>

    <!-- ══════════════ DONE ══════════════ -->
    {:else if screen === 'done'}
      <div class="panel center-text">
        <div class="big-icon accent">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor"
               stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12.5 L10 17.5 L19 7"/>
          </svg>
        </div>
        <h1>You're all set</h1>
        <p class="lede">
          Your notes are now encrypted and ready to sync.
        </p>
      </div>

    <!-- ══════════════ ERROR ══════════════ -->
    {:else if screen === 'error'}
      <div class="panel center-text">
        <div class="big-icon danger">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor"
               stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9"/>
            <path d="M12 8 V13 M12 16 V16.5"/>
          </svg>
        </div>
        <h1>Something went wrong</h1>
        <p class="lede">{errorMsg}</p>
        <div class="actions">
          <button class="primary" on:click={cancel}>Close</button>
        </div>
      </div>
    {/if}

  </div>

  <!-- ══════════════ RECOVERY HELP DIALOG ══════════════ -->
  {#if showLostPhraseHelp}
    <div class="dialog-overlay" on:click={() => (showLostPhraseHelp = false)} on:keydown role="presentation">
      <div class="dialog" on:click|stopPropagation on:keydown role="dialog" aria-modal="true">
        <h2 class="dialog-title">You can't recover your notes</h2>
        <p class="dialog-text">
          Your notes are encrypted with a key that only your recovery phrase can derive.
          Without it, we cannot read them — that's the point of the encryption.
        </p>

        <div class="dialog-options">
          <div class="dialog-option">
            <div class="dialog-option-title">If you have a Mote backup file</div>
            <div class="dialog-option-text">
              You exported a <code>.json</code> file from Settings → Data on another device.
              That file contains your notes and can restore everything except the cloud copy.
            </div>
          </div>

          <div class="dialog-option">
            <div class="dialog-option-title">If you have the original device</div>
            <div class="dialog-option-text">
              Open Mote on that device and unlock it with Face ID, Touch ID, or your
              device passcode — if you enabled biometrics when you first set up sync.
            </div>
          </div>

          <div class="dialog-option warning">
            <div class="dialog-option-title">Otherwise, you have to start fresh</div>
            <div class="dialog-option-text">
              Starting fresh deletes your cloud notes permanently and signs you out.
              Your local notes on this device are also removed. You can start over
              with a new phrase — anything you write from now on will sync normally.
            </div>
          </div>
        </div>

        <div class="dialog-actions">
          <button class="btn-secondary" on:click={() => (showLostPhraseHelp = false)}>
            Cancel
          </button>
          <button class="btn-danger" on:click={handleStartFresh} disabled={busy}>
            {busy ? 'Resetting…' : 'Start fresh'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .flow {
    position: fixed;
    inset: 0;
    z-index: 400;
    background: var(--paper);
    color: var(--ink);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow-y: auto;
    animation: fadeUp .28s var(--ease) both;
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .close-btn {
    position: fixed;
    top: 16px;
    right: 16px;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink-2);
    box-shadow: var(--shadow-2);
    cursor: pointer;
    z-index: 10;
  }
  .close-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .close-btn:hover:not(:disabled) { background: var(--paper-2); color: var(--ink); }

  .content {
    width: 100%;
    max-width: 440px;
    padding: 48px 24px;
  }

  .panel {
    animation: fadeUp .3s var(--ease) both;
  }
  .panel.center-text { text-align: center; }

  h1 {
    font-family: var(--font-serif);
    font-size: 27px;
    font-weight: 600;
    letter-spacing: -0.03em;
    line-height: 1.15;
    margin: 0 0 10px;
    color: var(--ink);
  }

  .lede {
    font-size: 14px;
    line-height: 1.55;
    color: var(--ink-2);
    margin: 0 0 24px;
  }
  .panel.center-text .lede { margin-left: auto; margin-right: auto; max-width: 340px; }

  .logo {
    width: 52px;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 16px;
    background: var(--ink);
    color: var(--paper);
    margin-bottom: 20px;
  }

  .big-icon {
    width: 68px;
    height: 68px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 22px;
    background: var(--paper-2);
    color: var(--ink-2);
    margin: 0 auto 20px;
  }
  .big-icon.accent { background: var(--accent-soft); color: var(--accent); }
  .big-icon.danger { background: var(--danger-soft); color: var(--danger); }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .method-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 14px 18px;
    border: 1px solid var(--hairline);
    border-radius: 14px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition: background .15s var(--ease), border-color .15s var(--ease), transform .15s var(--ease);
  }
  .method-btn:hover:not(:disabled) {
    background: var(--paper-2);
    border-color: var(--hairline-2);
  }
  .method-btn:active:not(:disabled) { transform: scale(.985); }
  .method-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .primary {
    padding: 14px 20px;
    border: none;
    border-radius: 12px;
    background: var(--ink);
    color: var(--paper);
    font: inherit;
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition: transform .15s var(--ease), opacity .15s var(--ease);
  }
  .primary:hover:not(:disabled) { opacity: 0.9; }
  .primary:active:not(:disabled) { transform: scale(.985); }
  .primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .ghost {
    padding: 11px 18px;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    transition: color .15s var(--ease), background .15s var(--ease);
  }
  .ghost:hover:not(:disabled) { color: var(--ink); background: var(--paper-2); }
  .ghost:disabled { opacity: 0.4; cursor: not-allowed; }

  .back-btn {
    padding: 6px 10px;
    margin-bottom: 16px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    align-self: flex-start;
    margin-left: -10px;
  }
  .back-btn:hover { background: var(--paper-2); color: var(--ink); }

  input {
    width: 100%;
    padding: 14px 16px;
    border: 1px solid var(--hairline);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
    font-weight: 500;
    letter-spacing: -0.005em;
    margin-bottom: 16px;
    transition: border-color .15s var(--ease), box-shadow .15s var(--ease);
    -webkit-appearance: none;
    appearance: none;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  input::placeholder { color: var(--ink-4); font-weight: 400; }

  .error {
    padding: 11px 14px;
    margin: 4px 0 14px;
    border-radius: 10px;
    background: var(--danger-soft);
    color: var(--danger);
    font-size: 12.5px;
    font-weight: 500;
    line-height: 1.5;
  }

  .warning {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 11px 14px;
    margin: 16px 0 20px;
    border-radius: 10px;
    background: var(--amber-soft, #fff5dc);
    color: var(--amber-ink, #825200);
    font-size: 12.5px;
    font-weight: 500;
    line-height: 1.5;
  }
  .warning svg { flex-shrink: 0; }

  .phrase-box {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    padding: 16px;
    border-radius: 14px;
    background: var(--accent-soft);
    margin-bottom: 12px;
  }
  .phrase-word {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    color: var(--accent);
    letter-spacing: 0.01em;
  }
  .word-num {
    font-size: 10px;
    font-weight: 700;
    color: var(--ink-3);
    min-width: 12px;
  }

  .phrase-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 4px;
  }
  .phrase-actions .ghost {
    flex: 1;
    border: 1px solid var(--hairline);
  }

  .fine-print {
    margin: 22px 0 0;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--ink-3);
    text-align: center;
  }

  .muted {
    font-size: 13px;
    color: var(--ink-3);
    margin: 12px 0 0;
  }

  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 0;
  }

  .spinner {
    width: 26px;
    height: 26px;
    border: 2.5px solid var(--hairline-2);
    border-top-color: var(--ink);
    border-radius: 50%;
    animation: spin .75s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Recovery help ──────────────────────────────────── */
  .link-btn {
    display: block;
    width: 100%;
    margin-top: 20px;
    padding: 10px;
    border: none;
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    text-align: center;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .link-btn:hover { color: var(--ink); }

  .dialog-overlay {
    position: fixed;
    inset: 0;
    z-index: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--overlay);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    animation: fadeUp .2s var(--ease) both;
  }

  .dialog {
    width: 100%;
    max-width: 460px;
    background: var(--surface);
    border-radius: 20px;
    padding: 24px 24px 20px;
    text-align: left;
    animation: fadeUp .25s var(--ease) both;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: var(--shadow-3);
  }

  .dialog-title {
    margin: 0 0 10px;
    font-family: var(--font-serif);
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.025em;
    color: var(--ink);
  }

  .dialog-text {
    margin: 0 0 20px;
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--ink-2);
  }

  .dialog-options {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 20px;
  }

  .dialog-option {
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--paper-2);
  }
  .dialog-option.warning {
    background: var(--amber-soft, #fff5dc);
    border: 1px solid rgba(200, 140, 20, .18);
  }

  .dialog-option-title {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--ink);
    margin-bottom: 4px;
  }
  .dialog-option.warning .dialog-option-title {
    color: var(--amber-ink, #825200);
  }

  .dialog-option-text {
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--ink-2);
  }
  .dialog-option.warning .dialog-option-text {
    color: var(--amber-ink, #825200);
  }

  .dialog-option-text code {
    font-family: var(--font-mono);
    font-size: 11.5px;
    padding: 1px 5px;
    background: var(--surface);
    border-radius: 4px;
  }

  .dialog-actions {
    display: flex;
    gap: 8px;
  }

  .btn-secondary,
  .btn-danger {
    flex: 1;
    padding: 13px;
    border: none;
    border-radius: 12px;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -0.005em;
    cursor: pointer;
    transition: transform .15s var(--ease), filter .15s var(--ease);
  }
  .btn-secondary {
    background: var(--paper-2);
    color: var(--ink);
  }
  .btn-secondary:hover { background: var(--hairline-2); }

  .btn-danger {
    background: var(--danger);
    color: #fff;
  }
  .btn-danger:hover:not(:disabled) { filter: brightness(1.05); }
  .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary:active,
  .btn-danger:active:not(:disabled) { transform: scale(.97); }

  @media (min-width: 500px) {
    .content { padding: 60px 32px; }
    h1 { font-size: 30px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .flow, .panel, .spinner, .dialog, .dialog-overlay { animation: none; transition: none; }
  }
</style>