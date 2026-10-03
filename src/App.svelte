<script>
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';

  import NotesList from './components/NotesList.svelte';
  import Editor from './components/Editor.svelte';
  import TrashView from './components/TrashView.svelte';
  import SettingsView from './components/SettingsView.svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import InstallBanner from './components/InstallBanner.svelte';
  import SignInFlow from './components/SignInFlow.svelte';
  import SharedListView from './components/SharedListView.svelte';

  import {
    listActiveNotes,
    listTrashNotes,
    getNote,
    putNote,
    softDeleteNote,
    restoreNote,
    purgeNote,
    emptyTrash,
    wipeAll,
  } from './lib/db.js';

  import { createNote } from './lib/notes.js';
  import { prefs, setPref, watchSystemTheme } from './lib/prefs.js';

  import {
    initAuth,
    authUser,
    authReady,
    completeEmailLinkSignIn,
    completeRedirectSignIn,
    signOutNow,
  } from './lib/auth.js';

  import {
    clearSyncKey,
    setBiometricAvailable,
    setSyncKey,
  } from './lib/sync-key.js';

  import {
    hasStoredKey,
    unlockWithBiometric,
  } from './lib/key-vault.js';

  // Key restore, the initial sync, the realtime listener and pushing local
  // edits all live in sync-store.js now. App only needs to react to results.
  import {
    notesVersion,
    runFullSync,
    handleOnline,
    handleOffline,
    resetSyncState,
  } from './lib/sync-store.js';

  import {
    createSharedList,
    getSharedTokenFromPath,
  } from './lib/shared.js';

  const SIGNIN_PENDING_KEY = 'mote:signinPending';

  // ═══════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════
  let view = 'list';             // 'list' | 'edit' | 'trash' | 'settings'
  let notes = [];
  let trashNotes = [];
  let trashCount = 0;
  let loading = true;
  let trashLoading = false;
  let currentNote = null;
  let kindPickerOpen = false;
  let commandPaletteOpen = false;
  let showSignInFlow = false;

  // Shared list routing
  let activeSharedToken = null;
  let newSharedKindPickerOpen = false;

  let untagSystemTheme = null;

  // ═══════════════════════════════════════════════════════════
  // NAVIGATION (hooked into browser history so the Android back
  // button and the iOS swipe-back gesture go up a level instead of
  // closing the app)
  // ═══════════════════════════════════════════════════════════
  function go(next) {
    if (view === next) return;
    window.history.pushState({ mote: next }, '');
    view = next;
  }

  function goBack() {
    if (window.history.state?.mote) {
      window.history.back(); // onPopState does the rest
    } else {
      showList();
    }
  }

  async function showList() {
    view = 'list';
    currentNote = null;
    await refreshList(true);
  }

  function onPopState(e) {
    const token = getSharedTokenFromPath();
    activeSharedToken = token;
    if (token) return;

    let target = e.state?.mote || 'list';
    if (target === 'edit' && !currentNote) target = 'list';
    view = target;

    if (target === 'list') {
      currentNote = null;
      refreshList(true);
    } else if (target === 'trash') {
      refreshTrash();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // BOOT
  // ═══════════════════════════════════════════════════════════
  function waitForAuthReady(timeoutMs = 5000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const unsub = authReady.subscribe((ready) => {
        if (ready) {
          finish();
          Promise.resolve().then(() => unsub());
        }
      });
      setTimeout(() => {
        finish();
        unsub();
      }, timeoutMs);
    });
  }

  onMount(async () => {
    untagSystemTheme = watchSystemTheme();
    initAuth();

    // After a reload, history may still carry a state from a deeper screen
    // while the app starts on the list. Reset it so Back behaves.
    if (window.history.state?.mote) {
      window.history.replaceState({}, '');
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('popstate', onPopState);

    // ── Process any pending sign-in returns ──────────────────
    // Email link (from an email) and Google redirect (from OAuth).
    // completeRedirectSignIn is shared with initAuth, so this is safe.
    await Promise.all([
      completeEmailLinkSignIn().catch((err) => {
        console.warn('[auth] email link completion failed:', err);
      }),
      completeRedirectSignIn().catch((err) => {
        console.warn('[auth] google redirect completion failed:', err);
      }),
    ]);

    // Wait for $authUser to settle instead of guessing with a timer
    await waitForAuthReady();

    // ── Recover mid-sign-in state across the redirect ────────
    const wasSigningIn = localStorage.getItem(SIGNIN_PENDING_KEY) === '1';
    if (wasSigningIn) {
      localStorage.removeItem(SIGNIN_PENDING_KEY);
      await recoverSignInFlow();
    }

    // ── Shared list route check ──────────────────────────────
    activeSharedToken = getSharedTokenFromPath();

    // ── Load personal data ───────────────────────────────────
    await refreshList();

    // ── PWA share target + shortcut actions ──────────────────
    const shared = await handleSharePayload();
    if (shared) return;

    await handleShortcutAction();
  });

  onDestroy(() => {
    if (untagSystemTheme) untagSystemTheme();
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    window.removeEventListener('popstate', onPopState);
  });

  // ═══════════════════════════════════════════════════════════
  // REMOTE CHANGES (realtime sync from other devices)
  // ═══════════════════════════════════════════════════════════
  // Sync wrote notes into IndexedDB. Reload quietly, with no spinner,
  // so the list updates in place.
  async function onRemoteChange() {
    await refreshList(true);
    if (view === 'trash') await refreshTrash();
  }

  $: if ($notesVersion > 0) onRemoteChange();

  // ═══════════════════════════════════════════════════════════
  // RECOVER FROM A SIGN-IN REDIRECT
  // ═══════════════════════════════════════════════════════════
  async function recoverSignInFlow() {
    if (!$authUser) {
      // Redirect didn't complete — reopen the flow so the user
      // can try again with visible error feedback.
      showSignInFlow = true;
      return;
    }

    // We're signed in. Decide whether onboarding is complete.
    try {
      const { doc, getDoc } = await import('firebase/firestore');
      const { db: firestore } = await import('./lib/firebase.js');
      const snap = await getDoc(doc(firestore, 'users', $authUser.uid));
      const profile = snap.data();

      if (!snap.exists() || !profile?.verifier) {
        // Onboarding unfinished — reopen flow; SignInFlow will
        // resolve to the setup-phrase or enter-phrase screen.
        showSignInFlow = true;
      }
      // If onboarding is complete, nothing to do — the saved device key
      // unlocks sync automatically, or the user is asked for the phrase.
    } catch (err) {
      console.error('[auth] recover sign-in failed:', err);
      showSignInFlow = true;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // REACTIVE: biometric availability
  // ═══════════════════════════════════════════════════════════
  $: if ($authUser && $authUser.uid) {
    hasStoredKey($authUser.uid)
      .then((has) => setBiometricAvailable(has))
      .catch(() => setBiometricAvailable(false));
  } else {
    setBiometricAvailable(false);
  }

  // ═══════════════════════════════════════════════════════════
  // GLOBAL SHORTCUTS
  // ═══════════════════════════════════════════════════════════
  function onGlobalKeydown(e) {
    if (activeSharedToken) return;

    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;

    if (e.key.toLowerCase() === 'k' && !e.shiftKey) {
      e.preventDefault();
      commandPaletteOpen = true;
      return;
    }

    if (e.key === ',') {
      e.preventDefault();
      go('settings');
      return;
    }

    if (e.key.toLowerCase() === 't' && e.shiftKey) {
      e.preventDefault();
      openTrash();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DATA
  // ═══════════════════════════════════════════════════════════
  // silent = true skips the loading spinner (used for background refreshes)
  async function refreshList(silent = false) {
    if (!silent) loading = true;
    try {
      notes = await listActiveNotes();
      const trashed = await listTrashNotes();
      trashCount = trashed.length;
    } catch (err) {
      console.error('[list] failed:', err);
      notes = [];
      trashCount = 0;
    } finally {
      loading = false;
    }
  }

  async function refreshTrash() {
    trashLoading = true;
    try {
      trashNotes = await listTrashNotes();
      trashCount = trashNotes.length;
    } catch (err) {
      console.error('[trash] failed:', err);
      trashNotes = [];
      trashCount = 0;
    } finally {
      trashLoading = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SHARE TARGET + SHORTCUTS
  // ═══════════════════════════════════════════════════════════
  async function handleSharePayload() {
    const params = new URLSearchParams(window.location.search);
    const title = params.get('title') || '';
    const text = params.get('text') || '';
    const url = params.get('url') || '';

    if (!title && !text && !url) return false;

    const parts = [];
    if (text) parts.push(text);
    if (url && !text.includes(url)) parts.push(url);
    const body = parts.join('\n\n').trim();

    if (!body) return false;

    try {
      const fresh = createNote({ kind: 'doc' });
      fresh.body = body;
      fresh.title = (title || body.split('\n')[0]).slice(0, 80);
      await putNote(fresh);
      window.history.replaceState({}, '', '/');
      currentNote = fresh;
      go('edit');
      return true;
    } catch (err) {
      console.error('[share] failed:', err);
      return false;
    }
  }

  async function handleShortcutAction() {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (!action) return;

    window.history.replaceState({}, '', '/');

    if (action === 'new-doc') await createOfKind('doc');
    else if (action === 'new-todo') await createOfKind('list', 'todo');
  }

  // ═══════════════════════════════════════════════════════════
  // NOTES
  // ═══════════════════════════════════════════════════════════
  async function openNote(id) {
    const note = await getNote(id);
    if (!note) return;
    currentNote = note;
    go('edit');
  }

  function handleCreate() {
    kindPickerOpen = true;
  }

  async function createOfKind(kind, listStyle) {
    kindPickerOpen = false;
    const fresh = createNote({ kind, listStyle });
    await putNote(fresh);
    currentNote = fresh;
    go('edit');
  }

  async function handleDelete(id) {
    await softDeleteNote(id);
    await refreshList(true);
  }

  function handleEditorBack() {
    goBack();
  }

  function handleSaved() {}

  async function handleImported() {
    await refreshList(true);
  }

  // ═══════════════════════════════════════════════════════════
  // SHARED LISTS
  // ═══════════════════════════════════════════════════════════
  function handleOpenShared(token) {
    activeSharedToken = token;
    window.history.pushState({ shared: true }, '', `/s/${token}`);
  }

  function handleNewShared() {
    if (!$authUser) {
      showSignInFlow = true;
      return;
    }
    newSharedKindPickerOpen = true;
  }

  async function createNewShared(kind, listStyle) {
    newSharedKindPickerOpen = false;
    try {
      const { token } = await createSharedList({ listStyle, title: '' });
      activeSharedToken = token;
      window.history.pushState({ shared: true }, '', `/s/${token}`);
    } catch (err) {
      console.error('[shared] create failed:', err);
      alert(err.message || 'Could not create shared list.');
    }
  }

  function closeShared() {
    if (window.history.state?.shared) {
      window.history.back(); // onPopState clears the token and refreshes
    } else {
      // Opened straight from a link: there is no earlier entry to go back to
      window.history.replaceState({}, '', '/');
      activeSharedToken = null;
      refreshList(true);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TRASH
  // ═══════════════════════════════════════════════════════════
  async function openTrash() {
    go('trash');
    await refreshTrash();
  }

  async function handleRestore(id) {
    await restoreNote(id);
    await refreshTrash();
    await refreshList(true);
  }

  async function handlePurge(id) {
    await purgeNote(id);
    await refreshTrash();
  }

  async function handleEmptyTrash() {
    await emptyTrash();
    await refreshTrash();
  }

  // ═══════════════════════════════════════════════════════════
  // COMMAND PALETTE
  // ═══════════════════════════════════════════════════════════
  function handleCommand(e) {
    const cmd = e.detail;
    commandPaletteOpen = false;

    if (cmd === 'new-doc') createOfKind('doc');
    else if (cmd === 'new-todo') createOfKind('list', 'todo');
    else if (cmd === 'new-bucket') createOfKind('list', 'bucket');
    else if (cmd === 'open-trash') openTrash();
    else if (cmd === 'open-settings') go('settings');
    else if (cmd === 'toggle-theme') {
      const next = $prefs.theme === 'dark' ? 'light' : 'dark';
      setPref('theme', next);
    } else if (cmd && typeof cmd === 'object' && cmd.openNote) {
      openNote(cmd.openNote);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SYNC HANDLERS
  // ═══════════════════════════════════════════════════════════
  function handleOpenSync() {
    showSignInFlow = true;
  }

  async function handleSyncNow() {
    try {
      await runFullSync();
      await refreshList(true);
    } catch (err) {
      console.error('[sync] manual sync failed:', err);
    }
  }

  async function handleBiometricUnlock() {
    if (!$authUser) return;
    const key = await unlockWithBiometric($authUser.uid);
    if (!key) return;

    try {
      const { doc, getDoc } = await import('firebase/firestore');
      const { db: firestore } = await import('./lib/firebase.js');
      const snap = await getDoc(doc(firestore, 'users', $authUser.uid));
      const data = snap.data();
      setSyncKey({ key, salt: data?.salt || null });
    } catch (err) {
      console.error('[sync] biometric unlock failed:', err);
    }
  }

  async function handleSignOut() {
    clearSyncKey();
    resetSyncState();
    await signOutNow();
  }

  async function handleSignOutClear() {
    const ok = confirm(
      'This removes all notes from this device. ' +
      'Anything not yet synced will be lost. Continue?'
    );
    if (!ok) return;

    try {
      // Stop sync first so the live listener can't write notes back
      // while the local database is being wiped.
      clearSyncKey();
      resetSyncState();
      await wipeAll();
      await signOutNow();
      currentNote = null;
      view = 'list';
      await refreshList(true);
    } catch (err) {
      console.error('[sign out clear] failed:', err);
      alert('Something went wrong clearing local data.');
    }
  }
</script>

<svelte:window on:keydown={onGlobalKeydown} />

<div class="mote">

  {#if activeSharedToken}
    <SharedListView
      token={activeSharedToken}
      on:back={closeShared}
      on:deleted={closeShared}
    />
  {:else}
    {#key view}
      <div in:fade={{ duration: 160 }}>
        {#if view === 'list'}
          <NotesList
            {notes}
            {loading}
            {trashCount}
            on:open={(e) => openNote(e.detail)}
            on:create={handleCreate}
            on:delete={(e) => handleDelete(e.detail)}
            on:settings={() => go('settings')}
            on:open-trash={openTrash}
            on:open-shared={(e) => handleOpenShared(e.detail)}
            on:new-shared={handleNewShared}
          />
        {:else if view === 'edit' && currentNote}
          <Editor
            note={currentNote}
            on:back={handleEditorBack}
            on:saved={handleSaved}
          />
        {:else if view === 'trash'}
          <TrashView
            notes={trashNotes}
            loading={trashLoading}
            on:back={goBack}
            on:restore={(e) => handleRestore(e.detail)}
            on:purge={(e) => handlePurge(e.detail)}
            on:empty={handleEmptyTrash}
          />
        {:else if view === 'settings'}
          <SettingsView
            on:back={goBack}
            on:open-trash={openTrash}
            on:imported={handleImported}
            on:open-sync={handleOpenSync}
            on:sync-now={handleSyncNow}
            on:unlock-biometric={handleBiometricUnlock}
            on:sign-out={handleSignOut}
            on:sign-out-clear={handleSignOutClear}
          />
        {/if}
      </div>
    {/key}

    <!-- ══════════════ PERSONAL NOTE KIND PICKER ══════════════ -->
    {#if kindPickerOpen}
      <div class="overlay" on:click={() => (kindPickerOpen = false)} on:keydown role="presentation">
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div class="sheet" on:click|stopPropagation on:keydown role="dialog" aria-modal="true">
          <div class="grabber"></div>
          <h3 class="sheet-title">What kind of note?</h3>
          <p class="sheet-text">Pick a starting point.</p>

          <div class="kinds">
            <button class="kind-card" on:click={() => createOfKind('doc')}>
              <div class="kind-icon doc">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                     stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 3.5 H15 L19 7.5 V20.5 H6 Z"/>
                  <path d="M15 3.5 V7.5 H19"/>
                  <path d="M9 12 H15 M9 15.5 H15 M9 19 H12"/>
                </svg>
              </div>
              <div class="kind-body">
                <div class="kind-name">Note</div>
                <div class="kind-desc">Free-form writing, markdown-friendly</div>
              </div>
            </button>

            <button class="kind-card" on:click={() => createOfKind('list', 'todo')}>
              <div class="kind-icon list">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                     stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 7 H10 M5 12 H10 M5 17 H10"/>
                  <path d="M14 7 L16 9 L20 5"/>
                  <path d="M14 12 L16 14 L20 10"/>
                  <path d="M14 17 L16 19 L20 15"/>
                </svg>
              </div>
              <div class="kind-body">
                <div class="kind-name">To-do</div>
                <div class="kind-desc">Private checklist, only on your devices</div>
              </div>
            </button>

            <button class="kind-card" on:click={() => createOfKind('list', 'bucket')}>
              <div class="kind-icon list">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                     stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3 L14.6 8.6 L20.8 9.3 L16.2 13.4 L17.4 19.4 L12 16.4 L6.6 19.4 L7.8 13.4 L3.2 9.3 L9.4 8.6 Z"/>
                </svg>
              </div>
              <div class="kind-body">
                <div class="kind-name">Bucket list</div>
                <div class="kind-desc">Your personal someday list</div>
              </div>
            </button>
          </div>

          <button class="cancel-btn" on:click={() => (kindPickerOpen = false)}>Cancel</button>
        </div>
      </div>
    {/if}

    <!-- ══════════════ NEW SHARED LIST KIND PICKER ══════════════ -->
    {#if newSharedKindPickerOpen}
      <div class="overlay" on:click={() => (newSharedKindPickerOpen = false)} on:keydown role="presentation">
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div class="sheet" on:click|stopPropagation on:keydown role="dialog" aria-modal="true">
          <div class="grabber"></div>
          <h3 class="sheet-title">New shared list</h3>
          <p class="sheet-text">
            Anyone with the link can edit it with you — live, from their own phone.
          </p>

          <div class="kinds">
            <button class="kind-card" on:click={() => createNewShared('list', 'todo')}>
              <div class="kind-icon list">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                     stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 7 H10 M5 12 H10 M5 17 H10"/>
                  <path d="M14 7 L16 9 L20 5"/>
                  <path d="M14 12 L16 14 L20 10"/>
                </svg>
              </div>
              <div class="kind-body">
                <div class="kind-name">To-do list</div>
                <div class="kind-desc">Things to get done, together</div>
              </div>
            </button>

            <button class="kind-card" on:click={() => createNewShared('list', 'bucket')}>
              <div class="kind-icon list">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                     stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3 L14.6 8.6 L20.8 9.3 L16.2 13.4 L17.4 19.4 L12 16.4 L6.6 19.4 L7.8 13.4 L3.2 9.3 L9.4 8.6 Z"/>
                </svg>
              </div>
              <div class="kind-body">
                <div class="kind-name">Bucket list</div>
                <div class="kind-desc">Adventures you want to have together</div>
              </div>
            </button>

            <button class="kind-card" on:click={() => createNewShared('list', 'shopping')}>
              <div class="kind-icon list">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                     stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="9" cy="20" r="1.5"/>
                  <circle cx="18" cy="20" r="1.5"/>
                  <path d="M3 4 H6 L8 16 H19 L21 7 H6"/>
                </svg>
              </div>
              <div class="kind-body">
                <div class="kind-name">Shopping list</div>
                <div class="kind-desc">Pick things up together, in real time</div>
              </div>
            </button>

            <button class="kind-card" on:click={() => createNewShared('list', 'checklist')}>
              <div class="kind-icon list">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                     stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="3"/>
                  <path d="M8 12 L11 15 L16 9"/>
                </svg>
              </div>
              <div class="kind-body">
                <div class="kind-name">Checklist</div>
                <div class="kind-desc">Simple yes/no items</div>
              </div>
            </button>
          </div>

          <button class="cancel-btn" on:click={() => (newSharedKindPickerOpen = false)}>Cancel</button>
        </div>
      </div>
    {/if}

    <!-- ══════════════ COMMAND PALETTE ══════════════ -->
    {#if commandPaletteOpen}
      <CommandPalette
        {notes}
        on:close={() => (commandPaletteOpen = false)}
        on:command={handleCommand}
      />
    {/if}

    <!-- ══════════════ SIGN-IN FLOW ══════════════ -->
    {#if showSignInFlow}
      <SignInFlow
        on:complete={() => (showSignInFlow = false)}
        on:close={() => (showSignInFlow = false)}
      />
    {/if}

    <!-- ══════════════ INSTALL BANNER ══════════════ -->
    <InstallBanner />
  {/if}
</div>

<style>
  /* No transform, filter or will-change on this wrapper: the screens inside
     are position: fixed, and any of those would break them. */
  .mote {
    background: var(--paper);
    color: var(--ink);
    min-height: 100vh;
    min-height: 100dvh;
    font-family: var(--font-sans);
    transition: background-color .25s var(--ease), color .25s var(--ease);
  }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: var(--overlay);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    animation: fadeUp .2s var(--ease) both;
  }
  .sheet {
    width: 100%;
    max-width: 440px;
    background: var(--surface);
    border-radius: 24px 24px 0 0;
    padding: 12px 22px calc(22px + env(safe-area-inset-bottom));
    animation: sheetIn .3s var(--ease) both;
  }
  @keyframes sheetIn {
    from { transform: translateY(24px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .grabber {
    width: 36px;
    height: 4px;
    border-radius: 3px;
    background: var(--hairline-2);
    margin: 0 auto 18px;
  }

  .sheet-title {
    margin: 0 0 4px;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.025em;
    color: var(--ink);
  }
  .sheet-text {
    margin: 0 0 18px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--ink-2);
  }

  .kinds {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .kind-card {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    min-height: 64px;
    padding: 14px 16px;
    border: 1px solid var(--hairline);
    border-radius: 16px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition: transform .15s var(--ease), box-shadow .2s var(--ease), border-color .2s var(--ease);
  }
  .kind-card:active { transform: scale(.985); background: var(--paper-2); }
  @media (hover: hover) {
    .kind-card:hover {
      transform: translateY(-1px);
      border-color: var(--hairline-2);
      box-shadow: var(--shadow-2);
    }
  }

  .kind-icon {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
  }
  .kind-icon.doc  { background: var(--paper-2); color: var(--ink-2); }
  .kind-icon.list { background: var(--accent-soft); color: var(--accent); }

  .kind-name {
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .kind-desc {
    font-size: 12px;
    color: var(--ink-3);
    margin-top: 2px;
    letter-spacing: -0.005em;
  }

  .cancel-btn {
    width: 100%;
    min-height: 46px;
    padding: 12px;
    border: none;
    border-radius: 12px;
    background: var(--paper-2);
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
  }
  .cancel-btn:active { transform: scale(.98); }

  @media (min-width: 500px) {
    .overlay { align-items: center; }
    .sheet {
      border-radius: 24px;
      max-width: 400px;
      padding: 24px 24px 20px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .overlay, .sheet, .kind-card { animation: none; transition: none; }
  }
</style>