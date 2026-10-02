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
    onNoteSaved,
  } from './lib/db.js';

  import { createNote } from './lib/notes.js';
  import { prefs, setPref, watchSystemTheme } from './lib/prefs.js';

  import {
    initAuth,
    authUser,
    completeEmailLinkSignIn,
    signOutNow,
  } from './lib/auth.js';

  import {
    syncKey,
    clearSyncKey,
    setBiometricAvailable,
    setSyncKey,
  } from './lib/sync-key.js';

  import {
    hasStoredKey,
    unlockWithBiometric,
  } from './lib/key-vault.js';

  import {
    syncStatus,
    runFullSync,
    queueNotePush,
    startPeriodicSync,
    stopPeriodicSync,
    handleOnline,
    handleOffline,
    resetSyncState,
  } from './lib/sync-store.js';

  // ═══════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════
  let view = 'list';
  let notes = [];
  let trashNotes = [];
  let trashCount = 0;
  let loading = true;
  let trashLoading = false;
  let currentNote = null;
  let kindPickerOpen = false;
  let commandPaletteOpen = false;
  let showSignInFlow = false;

  let untagSystemTheme = null;
  let unsubscribeSave = null;
  let unsubscribeSyncKey = null;
  let initialSyncRan = false;

  // ═══════════════════════════════════════════════════════════
  // BOOT
  // ═══════════════════════════════════════════════════════════
  onMount(async () => {
    untagSystemTheme = watchSystemTheme();
    initAuth();

    await completeEmailLinkSignIn().catch((err) => {
      console.warn('[auth] email link completion failed:', err);
    });

    await refreshList();

    // When a note is saved locally, queue a sync push.
    unsubscribeSave = onNoteSaved((note) => {
      queueNotePush(note.id);
    });

    // When the key unlocks, run an initial sync (once).
    unsubscribeSyncKey = syncKey.subscribe((s) => {
      if (!s.locked && s.key && $authUser && !initialSyncRan) {
        initialSyncRan = true;
        runFullSync().catch((err) => {
          console.warn('[sync] initial sync failed:', err);
        });
      }
      if (s.locked) {
        initialSyncRan = false;
      }
    });

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    startPeriodicSync();

    const shared = await handleSharePayload();
    if (shared) return;

    await handleShortcutAction();
  });

  onDestroy(() => {
    if (untagSystemTheme) untagSystemTheme();
    if (unsubscribeSave) unsubscribeSave();
    if (unsubscribeSyncKey) unsubscribeSyncKey();
    stopPeriodicSync();
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  });

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
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;

    if (e.key.toLowerCase() === 'k' && !e.shiftKey) {
      e.preventDefault();
      commandPaletteOpen = true;
      return;
    }

    if (e.key === ',') {
      e.preventDefault();
      if (view !== 'settings') view = 'settings';
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
  async function refreshList() {
    loading = true;
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
  // SHARE + SHORTCUTS
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
      currentNote = fresh;
      view = 'edit';
      window.history.replaceState({}, '', '/');
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
    view = 'edit';
  }

  function handleCreate() {
    kindPickerOpen = true;
  }

  async function createOfKind(kind, listStyle) {
    kindPickerOpen = false;
    const fresh = createNote({ kind, listStyle });
    await putNote(fresh);
    currentNote = fresh;
    view = 'edit';
  }

  async function handleDelete(id) {
    await softDeleteNote(id);
    await refreshList();
  }

  async function handleEditorBack() {
    view = 'list';
    currentNote = null;
    await refreshList();
  }

  function handleSaved() {}

  async function handleImported() {
    await refreshList();
  }

  // ═══════════════════════════════════════════════════════════
  // TRASH
  // ═══════════════════════════════════════════════════════════
  async function openTrash() {
    view = 'trash';
    await refreshTrash();
  }

  async function handleRestore(id) {
    await restoreNote(id);
    await refreshTrash();
    await refreshList();
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
    else if (cmd === 'open-settings') (view = 'settings');
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
      await refreshList();
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
    initialSyncRan = false;
    await signOutNow();
  }

  async function handleSignOutClear() {
    const ok = confirm(
      'This removes all notes from this device. ' +
      'Anything not yet synced will be lost. Continue?'
    );
    if (!ok) return;

    try {
      await wipeAll();
      clearSyncKey();
      resetSyncState();
      initialSyncRan = false;
      await signOutNow();
      currentNote = null;
      view = 'list';
      await refreshList();
    } catch (err) {
      console.error('[sign out clear] failed:', err);
      alert('Something went wrong clearing local data.');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // BACK HANDLERS
  // ═══════════════════════════════════════════════════════════
  async function settingsBack() {
    view = 'list';
    await refreshList();
  }

  async function trashBack() {
    view = 'list';
    await refreshList();
  }
</script>

<svelte:window on:keydown={onGlobalKeydown} />

<div class="mote">
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
          on:settings={() => (view = 'settings')}
          on:open-trash={openTrash}
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
          on:back={trashBack}
          on:restore={(e) => handleRestore(e.detail)}
          on:purge={(e) => handlePurge(e.detail)}
          on:empty={handleEmptyTrash}
        />
      {:else if view === 'settings'}
        <SettingsView
          on:back={settingsBack}
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

  <!-- ══════════════ KIND PICKER ══════════════ -->
  {#if kindPickerOpen}
    <div class="overlay" on:click={() => (kindPickerOpen = false)} on:keydown role="presentation">
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
              <div class="kind-desc">Checklist with items you can tick off</div>
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
              <div class="kind-desc">Things to do someday, no pressure</div>
            </div>
          </button>
        </div>

        <button class="cancel-btn" on:click={() => (kindPickerOpen = false)}>Cancel</button>
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
</div>

<style>
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
    padding: 14px 16px;
    border: 1px solid var(--hairline);
    border-radius: 16px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: transform .15s var(--ease), box-shadow .2s var(--ease), border-color .2s var(--ease);
  }
  .kind-card:hover {
    transform: translateY(-1px);
    border-color: var(--hairline-2);
    box-shadow: var(--shadow-2);
  }
  .kind-card:active { transform: scale(.985); }

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
    padding: 12px;
    border: none;
    border-radius: 12px;
    background: var(--paper-2);
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .cancel-btn:active { transform: scale(.98); }

  @media (min-width: 500px) {
    .overlay { align-items: center; }
    .sheet {
      border-radius: 24px;
      max-width: 380px;
      padding: 24px 24px 20px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .overlay, .sheet, .kind-card { animation: none; transition: none; }
  }
</style>