<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { prefs, setPref } from '../lib/prefs.js';
  import { storageStats, emptyTrash } from '../lib/db.js';

  const dispatch = createEventDispatcher();
   function openTrash() {
    dispatch('open-trash');
  }

  let stats = null;
  let emptiedMessage = false;

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
              {option === 'small' ? 'A' : option === 'medium' ? 'A' : 'A'}
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
            Everything is stored on this device only. Nothing is uploaded.
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
          <span class="about-value">v0.4</span>
        </div>
        <p class="about-text">
          A quiet place for thoughts. Everything stays on your device.
          Nothing is uploaded, ever.
        </p>
      </div>
    </section>

    {#if emptiedMessage}
      <div class="toast">Trash emptied</div>
    {/if}
  </div>
</div>


<style>
  .row-button {
    width: 100%;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background .15s var(--ease);
  }
  .row-button:hover {
    background: var(--paper-2);
  }

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

  /* ══════════════ CONTENT ══════════════ */
  .content {
    flex: 1;
    padding: 0 20px calc(40px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 26px;
  }

  .section {
    display: flex;
    flex-direction: column;
  }
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
  .row:first-of-type {
    border-radius: 16px 16px 0 0;
  }
  .row:last-child {
    border-radius: 0 0 16px 16px;
    border-bottom: none;
  }
  .row:only-of-type {
    border-radius: 16px;
  }

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

  /* ── segmented control ────────────────────────────── */
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

  /* Font-size segmented shows tiny preview letters */
  .seg-size {
    font-family: var(--font-serif);
  }
  .seg-size.small  { font-size: 11px; }
  .seg-size.medium { font-size: 13px; }
  .seg-size.large  { font-size: 15px; }

  /* ── select ────────────────────────────── */
  .select-wrap {
    position: relative;
    flex-shrink: 0;
  }
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

  /* ── action button ────────────────────────── */
  .action-btn {
    padding: 8px 14px;
    border: 1px solid var(--hairline-2);
    border-radius: 10px;
    background: transparent;
    color: var(--danger);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: -0.005em;
    cursor: pointer;
    flex-shrink: 0;
    transition: background .15s var(--ease), border-color .15s var(--ease);
  }
  .action-btn:hover:not(:disabled) {
    background: var(--danger-soft);
    border-color: var(--danger);
  }
  .action-btn:disabled {
    opacity: .4;
    cursor: not-allowed;
  }

  /* ── storage card ────────────────────────── */
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

  /* ── about ────────────────────────── */
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

  /* ── toast ────────────────────────── */
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

  /* ══════════════ CONFIRM ══════════════ */
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
  .confirm-btn.danger    { background: var(--danger); color: #fff; }

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
  }
</style>