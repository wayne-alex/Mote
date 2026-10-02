<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { prefs, setPref } from '../lib/prefs.js';
  import { storageStats, emptyTrash } from '../lib/db.js';
  import { downloadExport, parseImportFile, mergeImport } from '../lib/export.js';
  import { authUser } from '../lib/auth.js';
  import { syncKey } from '../lib/sync-key.js';
  import { syncStatus, lastSyncedAt } from '../lib/sync-store.js';

  const dispatch = createEventDispatcher();

  let stats = null;
  let confirmEmptyTrash = false;
  let emptiedMessage = false;

  // Export / import state
  let exportState = 'idle';
  let exportInfo = null;
  let exportError = '';

  let importFile = null;
  let importPreview = null;
  let importStrategy = 'keep-newest';
  let importState = 'idle';
  let importError = '';
  let importResult = null;

  let fileInputEl = null;

  onMount(async () => {
    await refreshStats();
  });

  async function refreshStats() {
    try {
      stats = await storageStats();
    } catch (err) {
      console.error('[settings] stats failed:', err);
    }
  }

  function formatBytes(n) {
    if (!n) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  async function doEmptyTrash() {
    await emptyTrash();
    confirmEmptyTrash = false;
    emptiedMessage = true;
    await refreshStats();
    setTimeout(() => (emptiedMessage = false), 2000);
  }

  async function doExport() {
    exportState = 'working';
    exportError = '';
    try {
      const result = await downloadExport();
      exportInfo = result;
      exportState = 'done';
      setTimeout(() => {
        if (exportState === 'done') exportState = 'idle';
      }, 4000);
    } catch (err) {
      console.error('[export] failed:', err);
      exportError = err.message || 'Export failed.';
      exportState = 'error';
    }
  }

  function pickImportFile() {
    fileInputEl?.click();
  }

  async function onFileChosen(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;

    importState = 'parsing';
    importError = '';
    importPreview = null;
    importResult = null;

    try {
      const parsed = await parseImportFile(file);
      importFile = file;
      importPreview = parsed;
      importState = 'preview';
    } catch (err) {
      console.error('[import] parse failed:', err);
      importError = err.message || 'Could not read the file.';
      importState = 'error';
    }
  }

  async function confirmImport() {
    if (!importPreview) return;
    importState = 'importing';
    importError = '';
    try {
      const result = await mergeImport(importPreview.notes, importStrategy);
      importResult = result;
      importState = 'done';
      await refreshStats();
      dispatch('imported', result);
    } catch (err) {
      console.error('[import] failed:', err);
      importError = err.message || 'Import failed.';
      importState = 'error';
    }
  }

  function cancelImport() {
    importFile = null;
    importPreview = null;
    importState = 'idle';
    importError = '';
    importResult = null;
  }

  function openTrash() {
    dispatch('open-trash');
  }

  function formatSyncTime(date) {
    if (!date) return '';
    return date.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="settings">
  <header class="head">
    <button class="back-btn" on:click={() => dispatch('back')} aria-label="Back">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 6 L9 12 L15 18"/>
      </svg>
    </button>
    <h1 class="title">Settings</h1>
    <span class="head-spacer"></span>
  </header>

  <div class="content">

    <!-- ══════════════ SYNC ══════════════ -->
    <section class="section">
      <h2 class="section-title">Sync</h2>

      {#if !$authUser}
        <button class="row row-button" on:click={() => dispatch('open-sync')}>
          <div class="row-label">
            <span class="row-name">Sync across devices</span>
            <span class="row-hint">Encrypt and back up your notes</span>
          </div>
          <div class="row-chevron">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                 stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 6 L15 12 L9 18"/>
            </svg>
          </div>
        </button>
      {:else}
        <div class="row">
          <div class="row-label">
            <span class="row-name">Signed in</span>
            <span class="row-hint">{$authUser.email}</span>
          </div>
          <span class="sync-state">
            {#if $syncKey.locked}
              <span class="state-pill locked">Locked</span>
            {:else}
              <span class="state-pill ok">Unlocked</span>
            {/if}
          </span>
        </div>

        {#if $syncKey.biometricAvailable && $syncKey.locked}
          <button class="row row-button" on:click={() => dispatch('unlock-biometric')}>
            <div class="row-label">
              <span class="row-name">Unlock with biometrics</span>
              <span class="row-hint">Use Face ID, Touch ID, or Windows Hello</span>
            </div>
            <div class="row-chevron">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 11 V15 M12 6 C15 6 17 8 17 11 V15 C17 19 15 21 12 21 C9 21 7 19 7 15 V11 C7 8 9 6 12 6 Z"/>
              </svg>
            </div>
          </button>
        {/if}

        {#if !$syncKey.locked}
          <div class="row">
            <div class="row-label">
              <span class="row-name">Last synced</span>
              <span class="row-hint">
                {#if $syncStatus === 'syncing'}
                  Syncing…
                {:else if $syncStatus === 'synced'}
                  Just now
                {:else if $syncStatus === 'offline'}
                  Offline — will sync when you reconnect
                {:else if $syncStatus === 'error'}
                  <span class="row-error">Sync failed. Will retry.</span>
                {:else if $lastSyncedAt}
                  {formatSyncTime($lastSyncedAt)}
                {:else}
                  Not synced yet
                {/if}
              </span>
            </div>
            <button class="action-btn" on:click={() => dispatch('sync-now')}
                    disabled={$syncStatus === 'syncing'}>
              {$syncStatus === 'syncing' ? '…' : 'Sync now'}
            </button>
          </div>
        {/if}

        <button class="row row-button danger" on:click={() => dispatch('sign-out')}>
          <div class="row-label">
            <span class="row-name">Sign out</span>
            <span class="row-hint">Keep local notes on this device</span>
          </div>
          <div class="row-chevron">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21 H5 A2 2 0 0 1 3 19 V5 A2 2 0 0 1 5 3 H9 M16 17 L21 12 L16 7 M21 12 H9"/>
            </svg>
          </div>
        </button>

        <button class="row row-button danger" on:click={() => dispatch('sign-out-clear')}>
          <div class="row-label">
            <span class="row-name">Sign out and clear local data</span>
            <span class="row-hint">Remove notes from this device</span>
          </div>
          <div class="row-chevron">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6 H21 M8 6 V4 A2 2 0 0 1 10 2 H14 A2 2 0 0 1 16 4 V6 M6 6 L7 20 A2 2 0 0 0 9 22 H15 A2 2 0 0 0 17 20 L18 6"/>
            </svg>
          </div>
        </button>
      {/if}
    </section>

    <!-- ══════════════ APPEARANCE ══════════════ -->
    <section class="section">
      <h2 class="section-title">Appearance</h2>

      <div class="row">
        <div class="row-label">
          <span class="row-name">Theme</span>
          <span class="row-hint">Light, dark, or follow the system</span>
        </div>
        <div class="segmented">
          {#each ['light', 'dark', 'system'] as option}
            <button
              class="seg-btn"
              class:selected={$prefs.theme === option}
              on:click={() => setPref('theme', option)}
            >
              {option === 'light' ? 'Light' : option === 'dark' ? 'Dark' : 'Auto'}
            </button>
          {/each}
        </div>
      </div>

      <div class="row">
        <div class="row-label">
          <span class="row-name">Text size</span>
          <span class="row-hint">Applies across the app</span>
        </div>
        <div class="segmented">
          {#each ['small', 'medium', 'large'] as option}
            <button
              class="seg-btn"
              class:selected={$prefs.fontSize === option}
              on:click={() => setPref('fontSize', option)}
            >
              <span class="seg-size {option}">Aa</span>
            </button>
          {/each}
        </div>
      </div>
    </section>

    <!-- ══════════════ NOTES ══════════════ -->
    <section class="section">
      <h2 class="section-title">Notes</h2>

      <div class="row">
        <div class="row-label">
          <span class="row-name">Default sort</span>
          <span class="row-hint">How the notes list orders itself</span>
        </div>
        <div class="select-wrap">
          <select
            class="select"
            value={$prefs.defaultSort}
            on:change={(e) => setPref('defaultSort', e.currentTarget.value)}
          >
            <option value="updated">Recently edited</option>
            <option value="created">Recently created</option>
            <option value="title">Title A → Z</option>
          </select>
          <svg class="select-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none"
               stroke="currentColor" stroke-width="2.4"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 9 L12 15 L18 9"/>
          </svg>
        </div>
      </div>

      <button class="row row-button" on:click={openTrash}>
        <div class="row-label">
          <span class="row-name">Trash</span>
          <span class="row-hint">
            {#if stats}
              {stats.trash === 0
                ? 'Empty'
                : `${stats.trash} ${stats.trash === 1 ? 'note' : 'notes'} waiting`}
            {:else}
              Loading…
            {/if}
          </span>
        </div>
        <div class="row-chevron">
          {#if stats && stats.trash > 0}
            <span class="row-badge">{stats.trash}</span>
          {/if}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 6 L15 12 L9 18"/>
          </svg>
        </div>
      </button>
    </section>

    <!-- ══════════════ DATA ══════════════ -->
    <section class="section">
      <h2 class="section-title">Data</h2>

      <div class="row">
        <div class="row-label">
          <span class="row-name">Export all notes</span>
          <span class="row-hint">
            {#if exportState === 'working'}
              Preparing…
            {:else if exportState === 'done' && exportInfo}
              Saved {exportInfo.count} {exportInfo.count === 1 ? 'note' : 'notes'} · {formatBytes(exportInfo.bytes)}
            {:else if exportState === 'error'}
              <span class="row-error">{exportError}</span>
            {:else}
              A single .json file with every note and preference
            {/if}
          </span>
        </div>
        <button
          class="action-btn"
          disabled={exportState === 'working'}
          on:click={doExport}
        >
          {exportState === 'working' ? '…' : 'Export'}
        </button>
      </div>

      <button class="row row-button" on:click={pickImportFile}>
        <div class="row-label">
          <span class="row-name">Import from a Mote backup</span>
          <span class="row-hint">Merge notes from an exported .json file</span>
        </div>
        <div class="row-chevron">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 4 V16 M7 11 L12 16 L17 11 M4 20 H20"/>
          </svg>
        </div>
      </button>

      <input
        bind:this={fileInputEl}
        type="file"
        accept="application/json,.json"
        class="hidden-file"
        on:change={onFileChosen}
      />
    </section>

    <!-- ══════════════ STORAGE ══════════════ -->
    <section class="section">
      <h2 class="section-title">Storage</h2>

      <div class="storage-card">
        {#if stats}
          <div class="storage-row">
            <span class="storage-label">Notes</span>
            <span class="storage-value">{stats.active}</span>
          </div>
          <div class="storage-row">
            <span class="storage-label">In trash</span>
            <span class="storage-value">{stats.trash}</span>
          </div>
          <div class="storage-row">
            <span class="storage-label">Total size</span>
            <span class="storage-value">{formatBytes(stats.bytes)}</span>
          </div>
          <div class="storage-note">
            Everything is stored on this device only. Nothing is uploaded unless you enable sync.
          </div>
        {:else}
          <div class="storage-loading">Loading…</div>
        {/if}
      </div>
    </section>

    <!-- ══════════════ ABOUT ══════════════ -->
    <section class="section">
      <h2 class="section-title">About</h2>
      <div class="about">
        <div class="about-row">
          <span class="about-label">Mote</span>
          <span class="about-value">v0.6</span>
        </div>
        <p class="about-text">
          A quiet place for thoughts. Your notes are encrypted on this device
          before they leave it — if you enable sync, even we can't read them.
        </p>
      </div>
    </section>

    {#if emptiedMessage}
      <div class="toast">Trash emptied</div>
    {/if}
  </div>
</div>

{#if confirmEmptyTrash}
  <div class="overlay" on:click={() => (confirmEmptyTrash = false)} on:keydown role="presentation">
    <div class="confirm" on:click|stopPropagation on:keydown role="dialog" aria-modal="true">
      <h3 class="confirm-title">Empty the trash?</h3>
      <p class="confirm-text">
        {stats?.trash || 0} {(stats?.trash || 0) === 1 ? 'note' : 'notes'} will be deleted
        permanently. This cannot be undone.
      </p>
      <div class="confirm-actions">
        <button class="confirm-btn secondary" on:click={() => (confirmEmptyTrash = false)}>
          Cancel
        </button>
        <button class="confirm-btn danger" on:click={doEmptyTrash}>Empty</button>
      </div>
    </div>
  </div>
{/if}

{#if importState === 'preview' && importPreview}
  <div class="overlay" on:click={cancelImport} on:keydown role="presentation">
    <div class="confirm wide" on:click|stopPropagation on:keydown role="dialog" aria-modal="true">
      <h3 class="confirm-title">Import {importPreview.notes.length} notes?</h3>
      <p class="confirm-text">
        {#if importPreview.exportedAt}
          Exported {new Date(importPreview.exportedAt).toLocaleDateString('en-KE', {
            day: 'numeric', month: 'long', year: 'numeric',
          })}.
        {/if}
        {#if importPreview.dropped > 0}
          <br /><span class="warn-note">
            {importPreview.dropped} unreadable {importPreview.dropped === 1 ? 'entry' : 'entries'} will be skipped.
          </span>
        {/if}
      </p>

      <div class="strategy">
        <div class="strategy-label">If a note already exists:</div>

        <label class="strategy-option" class:selected={importStrategy === 'keep-newest'}>
          <input type="radio" bind:group={importStrategy} value="keep-newest" />
          <div>
            <div class="strategy-name">Keep newest</div>
            <div class="strategy-hint">Use whichever was edited most recently</div>
          </div>
        </label>

        <label class="strategy-option" class:selected={importStrategy === 'keep-mine'}>
          <input type="radio" bind:group={importStrategy} value="keep-mine" />
          <div>
            <div class="strategy-name">Keep mine</div>
            <div class="strategy-hint">Existing notes always win</div>
          </div>
        </label>

        <label class="strategy-option" class:selected={importStrategy === 'keep-imported'}>
          <input type="radio" bind:group={importStrategy} value="keep-imported" />
          <div>
            <div class="strategy-name">Keep imported</div>
            <div class="strategy-hint">The file's version always wins</div>
          </div>
        </label>
      </div>

      <div class="confirm-actions">
        <button class="confirm-btn secondary" on:click={cancelImport}>Cancel</button>
        <button class="confirm-btn primary" on:click={confirmImport}>
          {importState === 'importing' ? 'Importing…' : 'Import'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if importState === 'done' && importResult}
  <div class="overlay" on:click={cancelImport} on:keydown role="presentation">
    <div class="confirm" on:click|stopPropagation on:keydown role="dialog" aria-modal="true">
      <h3 class="confirm-title">Import complete</h3>
      <p class="confirm-text">
        {#if importResult.created > 0}
          {importResult.created} new {importResult.created === 1 ? 'note' : 'notes'} added.
        {/if}
        {#if importResult.updated > 0}
          {importResult.updated} {importResult.updated === 1 ? 'note' : 'notes'} updated.
        {/if}
        {#if importResult.skipped > 0}
          {importResult.skipped} skipped.
        {/if}
      </p>
      <div class="confirm-actions">
        <button class="confirm-btn primary" on:click={cancelImport}>Done</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings {
    width: min(100%, 640px);
    margin: 0 auto;
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    animation: fadeUp .35s var(--ease) both;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 20px 20px 16px;
    flex-shrink: 0;
  }
  .back-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--ink);
    cursor: pointer;
    flex-shrink: 0;
    transition: background .15s var(--ease);
  }
  .back-btn:hover { background: var(--paper-2); }
  .back-btn:active { transform: scale(.94); }

  .title {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.025em;
    color: var(--ink);
  }
  .head-spacer { width: 34px; }

  .content {
    flex: 1;
    padding: 0 20px calc(40px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 26px;
  }

  .section { display: flex; flex-direction: column; }
  .section-title {
    margin: 0 0 10px 4px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-3);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--hairline);
    background: var(--surface);
  }
  .row:first-of-type { border-radius: 16px 16px 0 0; }
  .row:last-child { border-radius: 0 0 16px 16px; border-bottom: none; }
  .row:only-of-type { border-radius: 16px; }

  .row-label {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row-name {
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--ink);
  }
  .row-hint {
    font-size: 12px;
    font-weight: 400;
    color: var(--ink-3);
    letter-spacing: -0.005em;
  }
  .row-error {
    color: var(--danger);
    font-weight: 500;
  }

  .row-button {
    width: 100%;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background .15s var(--ease);
  }
  .row-button:hover { background: var(--paper-2); }
  .row-button.danger .row-name { color: var(--danger); }

  .row-chevron {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-3);
    flex-shrink: 0;
  }
  .row-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--danger);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .sync-state { flex-shrink: 0; }
  .state-pill {
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .state-pill.ok { background: var(--accent-soft); color: var(--accent); }
  .state-pill.locked { background: var(--paper-2); color: var(--ink-3); }

  /* ── segmented ── */
  .segmented {
    display: inline-flex;
    padding: 3px;
    border-radius: 11px;
    background: var(--paper-2);
    gap: 2px;
    flex-shrink: 0;
  }
  .seg-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: -0.005em;
    cursor: pointer;
    transition: background .15s var(--ease), color .15s var(--ease);
  }
  .seg-btn:hover { color: var(--ink); }
  .seg-btn.selected {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-1);
  }
  .seg-size { font-family: var(--font-serif); }
  .seg-size.small  { font-size: 11px; }
  .seg-size.medium { font-size: 13px; }
  .seg-size.large  { font-size: 15px; }

  /* ── select ── */
  .select-wrap { position: relative; flex-shrink: 0; }
  .select {
    appearance: none;
    -webkit-appearance: none;
    padding: 8px 30px 8px 12px;
    border: 1px solid var(--hairline-2);
    border-radius: 10px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: -0.005em;
    cursor: pointer;
    min-width: 150px;
    transition: border-color .15s var(--ease);
  }
  .select:hover { border-color: var(--ink-4); }
  .select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .select-chevron {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: var(--ink-3);
  }

  /* ── action button ── */
  .action-btn {
    padding: 8px 14px;
    border: 1px solid var(--hairline-2);
    border-radius: 10px;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: -0.005em;
    cursor: pointer;
    flex-shrink: 0;
    transition: background .15s var(--ease), border-color .15s var(--ease);
  }
  .action-btn:hover:not(:disabled) { background: var(--paper-2); border-color: var(--ink-4); }
  .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── storage ── */
  .storage-card {
    padding: 16px 18px;
    border-radius: 16px;
    background: var(--surface);
    border: 1px solid var(--hairline);
  }
  .storage-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 0;
  }
  .storage-label {
    font-size: 13px;
    color: var(--ink-2);
    letter-spacing: -0.005em;
  }
  .storage-value {
    font-size: 13px;
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--ink);
    letter-spacing: 0;
  }
  .storage-note {
    margin-top: 10px;
    padding-top: 12px;
    border-top: 1px solid var(--hairline);
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--ink-3);
    letter-spacing: -0.005em;
  }
  .storage-loading {
    padding: 12px 0;
    text-align: center;
    color: var(--ink-3);
    font-size: 12.5px;
  }

  /* ── about ── */
  .about {
    padding: 16px 18px;
    border-radius: 16px;
    background: var(--surface);
    border: 1px solid var(--hairline);
  }
  .about-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .about-label {
    font-family: var(--font-serif);
    font-size: 18px;
    font-weight: 500;
    letter-spacing: -0.03em;
    color: var(--ink);
  }
  .about-value {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--ink-3);
  }
  .about-text {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--ink-3);
    letter-spacing: -0.005em;
  }

  /* ── toast ── */
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(24px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 50;
    padding: 11px 18px;
    border-radius: 14px;
    background: var(--surface);
    color: var(--ink);
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: -0.005em;
    box-shadow: var(--shadow-3);
    animation: toastIn .28s var(--ease) both;
  }
  @keyframes toastIn {
    from { opacity: 0; transform: translate(-50%, 12px); }
    to   { opacity: 1; transform: translate(-50%, 0); }
  }

  /* ── dialogs ── */
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
  .confirm {
    width: 100%;
    max-width: 400px;
    background: var(--surface);
    border-radius: 22px 22px 0 0;
    padding: 22px 22px calc(22px + env(safe-area-inset-bottom));
    text-align: center;
    animation: sheetIn .3s var(--ease) both;
  }
  .confirm.wide { max-width: 440px; }
  @keyframes sheetIn {
    from { transform: translateY(20px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
  .confirm-title {
    margin: 0 0 6px;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.025em;
    color: var(--ink);
  }
  .confirm-text {
    margin: 0 0 20px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink-2);
  }
  .confirm-actions { display: flex; gap: 8px; }
  .confirm-btn {
    flex: 1;
    padding: 12px;
    border: none;
    border-radius: 12px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: transform .18s var(--ease);
  }
  .confirm-btn:active { transform: scale(.97); }
  .confirm-btn.secondary { background: var(--paper-2); color: var(--ink); }
  .confirm-btn.danger { background: var(--danger); color: #fff; }
  .confirm-btn.primary { background: var(--ink); color: var(--paper); }

  .hidden-file { display: none; }
  .warn-note { color: var(--amber-ink, #825200); font-weight: 500; }

  .strategy {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 4px 0 20px;
    text-align: left;
  }
  .strategy-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3);
    margin-bottom: 4px;
    padding-left: 2px;
  }
  .strategy-option {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--hairline);
    border-radius: 12px;
    background: var(--surface);
    cursor: pointer;
    transition: border-color .15s var(--ease), background .15s var(--ease);
  }
  .strategy-option:hover { border-color: var(--hairline-2); }
  .strategy-option.selected {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .strategy-option input[type="radio"] {
    accent-color: var(--accent);
    flex-shrink: 0;
  }
  .strategy-name {
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--ink);
  }
  .strategy-hint {
    font-size: 11.5px;
    color: var(--ink-3);
    margin-top: 1px;
    letter-spacing: -0.005em;
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @media (min-width: 500px) {
    .overlay { align-items: center; }
    .confirm {
      border-radius: 22px;
      max-width: 360px;
      padding: 24px 24px 20px;
    }
    .confirm.wide { max-width: 440px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .settings, .overlay, .confirm, .toast { animation: none; transition: none; }
  }
</style>