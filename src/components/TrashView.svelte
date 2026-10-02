<script>
  import { createEventDispatcher } from 'svelte';
  import SwipeRow from './SwipeRow.svelte';
  import { deriveDisplayTitle, formatUpdated } from '../lib/notes.js';

  const dispatch = createEventDispatcher();

  export let notes = [];
  export let loading = false;

  let confirmEmpty = false;

  function emptyTrash() {
    dispatch('empty');
    confirmEmpty = false;
  }
</script>

<div class="trash">
  <header class="head">
    <button class="back-btn" on:click={() => dispatch('back')} aria-label="Back">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 6 L9 12 L15 18"/>
      </svg>
    </button>

    <div class="head-center">
      <h1 class="title">Trash</h1>
      <p class="sub">
        {#if notes.length === 0}
          Empty
        {:else}
          {notes.length} {notes.length === 1 ? 'note' : 'notes'}
        {/if}
      </p>
    </div>

    {#if notes.length > 0}
      <button class="empty-btn" on:click={() => (confirmEmpty = true)} aria-label="Empty trash">
        Empty
      </button>
    {:else}
      <span class="head-spacer"></span>
    {/if}
  </header>

  {#if loading}
    <div class="loading"><div class="spinner"></div></div>

  {:else if notes.length === 0}
    <div class="empty">
      <div class="empty-mark">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"
             stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6 H21 M8 6 V4 A2 2 0 0 1 10 2 H14 A2 2 0 0 1 16 4 V6 M6 6 L7 20 A2 2 0 0 0 9 22 H15 A2 2 0 0 0 17 20 L18 6"/>
        </svg>
      </div>
      <h2 class="empty-title">Trash is empty</h2>
      <p class="empty-text">Deleted notes land here before you empty them for good.</p>
    </div>

  {:else}
    <ul class="notes">
      {#each notes as note (note.id)}
        <li>
          <SwipeRow
            variant="restore"
            restoreLabel="Restore"
            on:restore={() => dispatch('restore', note.id)}
          >
            <div class="note">
              <div class="note-top">
                <h3 class="note-title">{deriveDisplayTitle(note)}</h3>
              </div>
              <div class="note-meta">
                Deleted {formatUpdated(note.deletedAt)}
              </div>

              <div class="row-actions">
                <button
                  class="row-action-btn restore"
                  on:click={() => dispatch('restore', note.id)}
                >
                  Restore
                </button>
                <button
                  class="row-action-btn danger"
                  on:click={() => dispatch('purge', note.id)}
                >
                  Delete forever
                </button>
              </div>
            </div>
          </SwipeRow>
        </li>
      {/each}
    </ul>
    <p class="hint">Swipe left to restore, or tap the buttons below each note.</p>
  {/if}

</div>

{#if confirmEmpty}
  <div class="overlay" on:click={() => (confirmEmpty = false)} on:keydown role="presentation">
    <div class="confirm" on:click|stopPropagation on:keydown role="dialog" aria-modal="true">
      <h3 class="confirm-title">Empty the trash?</h3>
      <p class="confirm-text">
        {notes.length} {notes.length === 1 ? 'note' : 'notes'} will be deleted permanently.
        This cannot be undone.
      </p>
      <div class="confirm-actions">
        <button class="confirm-btn secondary" on:click={() => (confirmEmpty = false)}>
          Cancel
        </button>
        <button class="confirm-btn danger" on:click={emptyTrash}>
          Empty
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .trash {
    width: min(100%, 640px);
    margin: 0 auto;
    min-height: 100vh;
    min-height: 100dvh;
    padding: 20px 20px calc(32px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    animation: fadeUp .35s var(--ease) both;
  }

  /* ══════════════ HEADER ══════════════ */
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 24px;
    padding: 0 2px;
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

  .head-center {
    flex: 1;
    min-width: 0;
    text-align: center;
  }
  .title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.025em;
    color: var(--ink);
  }
  .sub {
    margin: 2px 0 0;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--ink-3);
    letter-spacing: -0.005em;
  }

  .empty-btn {
    padding: 8px 14px;
    border: 1px solid var(--hairline-2);
    border-radius: 10px;
    background: transparent;
    color: var(--danger);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: -0.005em;
    cursor: pointer;
    flex-shrink: 0;
    transition: background .15s var(--ease), border-color .15s var(--ease);
  }
  .empty-btn:hover {
    background: var(--danger-soft);
    border-color: var(--danger);
  }
  .head-spacer { width: 62px; }

  /* ══════════════ NOTES ══════════════ */
  .notes {
    list-style: none;
    padding: 0;
    margin: 0 0 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .note {
    padding: 14px 16px;
    border: 1px solid var(--hairline);
    border-radius: 16px;
    background: var(--surface);
    color: var(--ink);
    transition: background .15s var(--ease);
  }
  .note:hover { background: var(--paper-2); }

  .note-top {
    margin-bottom: 4px;
  }
  .note-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note-meta {
    font-size: 11px;
    font-weight: 500;
    color: var(--ink-4);
    letter-spacing: 0.01em;
  }

  .row-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .row-action-btn {
    padding: 7px 12px;
    border: none;
    border-radius: 9px;
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: -0.005em;
    cursor: pointer;
    transition: transform .15s var(--ease), opacity .15s var(--ease);
  }
  .row-action-btn:active { transform: scale(.97); }
  .row-action-btn.restore {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .row-action-btn.restore:hover { opacity: .85; }
  .row-action-btn.danger {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .row-action-btn.danger:hover { opacity: .85; }

  .hint {
    text-align: center;
    font-size: 11.5px;
    color: var(--ink-4);
    margin: 0;
    padding: 0 20px;
    line-height: 1.5;
  }

  /* ══════════════ EMPTY / LOADING ══════════════ */
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 40px 24px;
    gap: 4px;
  }
  .empty-mark {
    width: 64px;
    height: 64px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--paper-2);
    color: var(--ink-3);
    margin-bottom: 12px;
  }
  .empty-title {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.025em;
    color: var(--ink);
  }
  .empty-text {
    margin: 6px 0 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink-3);
    max-width: 260px;
  }

  .loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
  }
  .spinner {
    width: 22px;
    height: 22px;
    border: 2.5px solid var(--hairline-2);
    border-top-color: var(--ink);
    border-radius: 50%;
    animation: spin .75s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
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

  @media (min-width: 500px) {
    .overlay { align-items: center; }
    .confirm {
      border-radius: 22px;
      max-width: 360px;
      padding: 24px 24px 20px;
    }
  }
</style>