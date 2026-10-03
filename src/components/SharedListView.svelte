<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { authUser } from '../lib/auth.js';
  import {
    watchSharedList,
    fetchSharedList,
    joinSharedList,
    updateSharedTitle,
    addItemToShared,
    removeItemFromShared,
    toggleItemInShared,
    updateItemTextInShared,
    deleteSharedList,
    shareUrlFor,
  } from '../lib/shared.js';
  import { rememberShared, forgetShared } from '../lib/shared-store.js';

  const dispatch = createEventDispatcher();

  export let token = null;

  let status = 'loading';  // 'loading' | 'ready' | 'notfound' | 'error'
  let list = null;
  let unsub = null;

  // Local editing buffer for the title (avoid writing per keystroke)
  let titleBuffer = '';
  let titleDirty = false;
  let titleSaveTimer = null;

  // Menu
  let menuOpen = false;
  let shareSheetOpen = false;
  let shareCopied = false;
  let revokeConfirmOpen = false;
  let busy = false;

  onMount(async () => {
    if (!token) {
      status = 'error';
      return;
    }

    // If signed in, try joining (adds self to members if not already)
    if ($authUser) {
      try { await joinSharedList(token); } catch (err) { console.warn(err); }
    }

    // Subscribe to real-time updates
    unsub = watchSharedList(token, (data) => {
      if (!data) {
        status = 'notfound';
        list = null;
        return;
      }
      list = data;
      status = 'ready';

      // Sync the title buffer if the remote changed and the user isn't editing
      if (!titleDirty) {
        titleBuffer = data.title || '';
      }

      // Remember this list locally so it shows in the Shared section
      if ($authUser) {
        const role = data.ownerId === $authUser.uid ? 'owner' : 'member';
        rememberShared(token, {
          title: data.title || '',
          kind: data.kind,
          listStyle: data.listStyle || 'todo',
          role,
        });
      }
    });
  });

  onDestroy(() => {
    if (unsub) unsub();
    if (titleSaveTimer) clearTimeout(titleSaveTimer);
  });

  // ═══════════════════════════════════════════════════════════
  // DERIVED
  // ═══════════════════════════════════════════════════════════
  $: isOwner = list && $authUser && list.ownerId === $authUser.uid;
  $: memberCount = list?.members?.length || 0;
  $: doneCount = list?.items?.filter((i) => i.done).length || 0;
  $: totalCount = list?.items?.length || 0;
  $: membersLabel =
    memberCount <= 1 ? 'Only you' :
    memberCount === 2 ? '2 people' :
    `${memberCount} people`;

  $: kindLabel = (() => {
    if (!list) return '';
    switch (list.listStyle) {
      case 'bucket':    return 'Bucket list';
      case 'shopping':  return 'Shopping list';
      case 'checklist': return 'Checklist';
      default:          return 'To-do list';
    }
  })();

  // ═══════════════════════════════════════════════════════════
  // TITLE
  // ═══════════════════════════════════════════════════════════
  function onTitleInput() {
    titleDirty = true;
    if (titleSaveTimer) clearTimeout(titleSaveTimer);
    titleSaveTimer = setTimeout(async () => {
      if (!list) return;
      try {
        await updateSharedTitle(token, titleBuffer.trim());
        titleDirty = false;
      } catch (err) {
        console.error('[shared] title save failed:', err);
      }
    }, 600);
  }

  function onTitleBlur() {
    if (titleSaveTimer) clearTimeout(titleSaveTimer);
    if (titleDirty && list) {
      updateSharedTitle(token, titleBuffer.trim())
        .then(() => (titleDirty = false))
        .catch((err) => console.error(err));
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ITEMS
  // ═══════════════════════════════════════════════════════════
  async function addItem() {
    if (!list) return;
    try {
      await addItemToShared(token, '');
    } catch (err) {
      console.error('[shared] add failed:', err);
    }
  }

  async function removeItem(itemId) {
    try { await removeItemFromShared(token, itemId); }
    catch (err) { console.error(err); }
  }

  async function toggleItem(itemId) {
    try { await toggleItemInShared(token, itemId); }
    catch (err) { console.error(err); }
  }

  async function updateItemText(itemId, text) {
    try { await updateItemTextInShared(token, itemId, text); }
    catch (err) { console.error(err); }
  }

  function onItemKeydown(e, item, index) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Add a new item after this one
      (async () => {
        const current = list;
        if (!current) return;
        const newItem = {
          id: crypto.randomUUID(),
          text: '',
          done: false,
          doneAt: null,
        };
        const items = [...(current.items || [])];
        items.splice(index + 1, 0, newItem);
        const { updateSharedList } = await import('../lib/shared.js');
        await updateSharedList(token, { items });
        // Focus the new item's input on the next tick
        setTimeout(() => {
          const inputs = document.querySelectorAll('.item-input');
          inputs[index + 1]?.focus();
        }, 50);
      })();
    }
    if (e.key === 'Backspace' && !item.text) {
      e.preventDefault();
      const inputs = document.querySelectorAll('.item-input');
      removeItem(item.id);
      setTimeout(() => inputs[Math.max(0, index - 1)]?.focus(), 50);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SHARE / DELETE
  // ═══════════════════════════════════════════════════════════
  function openShareSheet() {
    menuOpen = false;
    shareSheetOpen = true;
    shareCopied = false;
  }

  async function copyShareUrl() {
    const url = shareUrlFor(token);
    try {
      await navigator.clipboard.writeText(url);
      shareCopied = true;
      setTimeout(() => (shareCopied = false), 1800);
    } catch {}
  }

  async function nativeShare() {
    const url = shareUrlFor(token);
    if (navigator.share) {
      try {
        await navigator.share({
          title: titleBuffer || 'Shared list',
          text: 'Join my list on Mote',
          url,
        });
      } catch {}
    } else {
      copyShareUrl();
    }
  }

  async function confirmDelete() {
    if (!isOwner) return;
    busy = true;
    try {
      await deleteSharedList(token);
      forgetShared(token);
      revokeConfirmOpen = false;
      dispatch('deleted');
    } catch (err) {
      console.error('[shared] delete failed:', err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="shared-screen">

  <!-- ══════════════ HEADER ══════════════ -->
  <header class="head">
    <button class="back-btn" on:click={() => dispatch('back')} aria-label="Back">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 6 L9 12 L15 18"/>
      </svg>
    </button>

    <div class="head-center">
      <span class="live-badge">
        <span class="live-dot"></span>
        Live
      </span>
      <span class="member-label">{membersLabel}</span>
    </div>

    <button class="menu-btn" on:click={() => (menuOpen = !menuOpen)} aria-label="Options">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="6" r="1"/>
        <circle cx="12" cy="12" r="1"/>
        <circle cx="12" cy="18" r="1"/>
      </svg>
    </button>

    {#if menuOpen}
      <div class="menu">
        <button on:click={openShareSheet}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="6" cy="12" r="2"/>
            <circle cx="18" cy="6" r="2"/>
            <circle cx="18" cy="18" r="2"/>
            <path d="M8 11 L16 7 M8 13 L16 17"/>
          </svg>
          Share link
        </button>
        {#if isOwner}
          <button class="danger" on:click={() => { menuOpen = false; revokeConfirmOpen = true; }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6 H21 M8 6 V4 A2 2 0 0 1 10 2 H14 A2 2 0 0 1 16 4 V6 M6 6 L7 20 A2 2 0 0 0 9 22 H15 A2 2 0 0 0 17 20 L18 6"/>
            </svg>
            Delete list
          </button>
        {/if}
      </div>
    {/if}
  </header>

  <!-- ══════════════ BODY ══════════════ -->
  {#if status === 'loading'}
    <div class="center">
      <div class="spinner"></div>
      <p class="muted">Loading…</p>
    </div>

  {:else if status === 'notfound'}
    <div class="center">
      <div class="state-icon">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor"
             stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3 L2 20 H22 Z M12 10 V14 M12 17 V17.5"/>
        </svg>
      </div>
      <h2 class="state-title">This list is gone</h2>
      <p class="state-text">
        The owner deleted it, or the link was mistyped.
      </p>
      <button class="btn-secondary" on:click={() => dispatch('back')}>Go back</button>
    </div>

  {:else if status === 'error'}
    <div class="center">
      <div class="state-icon danger">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor"
             stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <path d="M12 8 V13 M12 16 V16.5"/>
        </svg>
      </div>
      <h2 class="state-title">Something went wrong</h2>
      <button class="btn-secondary" on:click={() => dispatch('back')}>Go back</button>
    </div>

  {:else if status === 'ready' && list}
    <div class="body">
      <div class="list-meta-row">
        <span class="kind-pill">{kindLabel}</span>
        <span class="count-pill">{doneCount} of {totalCount} done</span>
      </div>

      <input
        class="list-title"
        bind:value={titleBuffer}
        on:input={onTitleInput}
        on:blur={onTitleBlur}
        placeholder="List name"
        autocomplete="off"
        spellcheck="false"
      />

      <ul class="items">
        {#each list.items || [] as item, i (item.id)}
          <li class="item" class:done={item.done}>
            <button
              type="button"
              class="checkbox"
              class:on={item.done}
              on:click={() => toggleItem(item.id)}
              aria-label={item.done ? 'Mark as not done' : 'Mark as done'}
            >
              {#if item.done}
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
                     stroke="currentColor" stroke-width="3.2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12.5 L10 17.5 L19 7"/>
                </svg>
              {/if}
            </button>

            <input
              class="item-input"
              type="text"
              value={item.text}
              on:input={(e) => updateItemText(item.id, e.currentTarget.value)}
              on:keydown={(e) => onItemKeydown(e, item, i)}
              placeholder="New item"
              autocomplete="off"
              spellcheck="false"
            />

            <button
              type="button"
              class="remove"
              on:click={() => removeItem(item.id)}
              aria-label="Remove item"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                   stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 6 L18 18 M18 6 L6 18"/>
              </svg>
            </button>
          </li>
        {/each}
      </ul>

      <button class="add-item" on:click={addItem} type="button">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
             stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5 V19 M5 12 H19"/>
        </svg>
        Add item
      </button>
    </div>
  {/if}

  <!-- ══════════════ SHARE SHEET ══════════════ -->
  {#if shareSheetOpen}
    <div class="overlay" on:click={() => (shareSheetOpen = false)} on:keydown role="presentation">
      <div class="sheet" on:click|stopPropagation on:keydown role="dialog" aria-modal="true">
        <div class="grabber"></div>
        <h2 class="sheet-title">Share this list</h2>
        <p class="sheet-text">
          Anyone with this link can open the list and edit it with you — live.
          If they don't have a Mote account yet, they'll be asked to sign in.
        </p>

        <div class="url-box">
          <input
            type="text"
            class="url-input"
            readonly
            value={shareUrlFor(token)}
            on:focus={(e) => e.currentTarget.select()}
          />
          <button class="copy-btn" on:click={copyShareUrl}>
            {shareCopied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div class="sheet-actions">
          <button class="btn-secondary" on:click={() => (shareSheetOpen = false)}>Close</button>
          {#if navigator?.share}
            <button class="btn-primary" on:click={nativeShare}>Share…</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- ══════════════ DELETE CONFIRM ══════════════ -->
  {#if revokeConfirmOpen}
    <div class="overlay" on:click={() => (revokeConfirmOpen = false)} on:keydown role="presentation">
      <div class="sheet" on:click|stopPropagation on:keydown role="dialog" aria-modal="true">
        <div class="grabber"></div>
        <h2 class="sheet-title">Delete this list?</h2>
        <p class="sheet-text">
          The list will be removed for everyone you shared it with.
          This can't be undone.
        </p>
        <div class="sheet-actions">
          <button class="btn-secondary" on:click={() => (revokeConfirmOpen = false)}>Cancel</button>
          <button class="btn-danger" on:click={confirmDelete} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .shared-screen {
    width: min(100%, 720px);
    margin: 0 auto;
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--paper);
    color: var(--ink);
    animation: fadeUp .3s var(--ease) both;
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── Header ─────────────────────────────── */
  .head {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--hairline);
    flex-shrink: 0;
  }
  .back-btn, .menu-btn {
    width: 34px; height: 34px;
    display: flex; align-items: center; justify-content: center;
    border: none; border-radius: 10px;
    background: transparent;
    color: var(--ink);
    cursor: pointer;
    transition: background .15s var(--ease);
  }
  .back-btn:hover, .menu-btn:hover { background: var(--paper-2); }

  .head-center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-width: 0;
  }

  .live-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 10.5px;
    font-weight: 750;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .live-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.4; }
  }

  .member-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--ink-3);
  }

  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 12px;
    z-index: 30;
    min-width: 180px;
    padding: 6px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    box-shadow: var(--shadow-3);
    animation: fadeUp .15s var(--ease) both;
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background .1s var(--ease);
  }
  .menu button:hover { background: var(--paper-2); }
  .menu button.danger { color: var(--danger); }

  /* ── Body ───────────────────────────────── */
  .body {
    flex: 1;
    padding: 24px 24px calc(60px + env(safe-area-inset-bottom));
    overflow-y: auto;
  }

  .list-meta-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .kind-pill {
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 10.5px;
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .count-pill {
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--paper-2);
    color: var(--ink-3);
    font-size: 11px;
    font-weight: 600;
  }

  .list-title {
    width: 100%;
    border: none;
    outline: none;
    background: transparent;
    font-family: var(--font-serif);
    font-size: 28px;
    font-weight: 500;
    letter-spacing: -0.03em;
    color: var(--ink);
    padding: 0;
    margin-bottom: 20px;
  }
  .list-title::placeholder { color: var(--ink-4); font-style: italic; }

  /* ── Items ──────────────────────────────── */
  .items {
    list-style: none;
    padding: 0;
    margin: 0 0 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    min-height: 42px;
  }
  .checkbox {
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    border: 1.5px solid var(--ink-4);
    border-radius: 7px;
    background: transparent;
    color: #fff;
    cursor: pointer;
    padding: 0;
    transition: background .18s var(--ease), border-color .18s var(--ease);
    flex-shrink: 0;
  }
  .checkbox:hover { border-color: var(--ink-3); }
  .checkbox.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .item-input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-family: var(--font-sans);
    font-size: 15px;
    color: var(--ink);
    padding: 4px 0;
    letter-spacing: -0.005em;
  }
  .item-input::placeholder { color: var(--ink-4); }
  .item.done .item-input {
    color: var(--ink-3);
    text-decoration: line-through;
    text-decoration-color: var(--ink-4);
  }
  .remove {
    width: 26px; height: 26px;
    display: flex; align-items: center; justify-content: center;
    border: none; border-radius: 7px;
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity .15s var(--ease), background .15s var(--ease), color .15s var(--ease);
  }
  .item:hover .remove { opacity: 1; }
  .remove:hover { background: var(--paper-2); color: var(--danger); }

  .add-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 14px;
    border: 1px dashed var(--hairline-2);
    border-radius: 10px;
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background .18s var(--ease), border-color .18s var(--ease), color .18s var(--ease);
  }
  .add-item:hover {
    background: var(--paper-2);
    border-color: var(--ink-4);
    color: var(--ink);
  }

  /* ── Center states ─────────────────────── */
  .center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 24px;
    text-align: center;
    min-height: 50vh;
  }
  .state-icon {
    width: 68px; height: 68px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 22px;
    background: var(--amber-soft, #fff5dc);
    color: var(--amber-ink, #825200);
    margin-bottom: 20px;
  }
  .state-icon.danger {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .state-title {
    font-family: var(--font-serif);
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.025em;
    margin: 0 0 8px;
    color: var(--ink);
  }
  .state-text {
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--ink-3);
    max-width: 300px;
    margin: 0 0 22px;
  }
  .muted { font-size: 13px; color: var(--ink-3); margin-top: 12px; }

  .spinner {
    width: 26px; height: 26px;
    border: 2.5px solid var(--hairline-2);
    border-top-color: var(--ink);
    border-radius: 50%;
    animation: spin .75s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Overlays ───────────────────────────── */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 250;
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
    text-align: left;
  }
  @keyframes sheetIn {
    from { transform: translateY(24px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
  .grabber {
    width: 36px; height: 4px;
    border-radius: 3px;
    background: var(--hairline-2);
    margin: 0 auto 18px;
  }
  .sheet-title {
    margin: 0 0 6px;
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

  .url-box {
    display: flex;
    gap: 6px;
    margin-bottom: 16px;
  }
  .url-input {
    flex: 1;
    min-width: 0;
    padding: 12px 14px;
    border: 1px solid var(--hairline);
    border-radius: 12px;
    background: var(--paper-2);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
  }
  .url-input:focus { outline: none; border-color: var(--accent); }
  .copy-btn {
    padding: 12px 16px;
    border: none;
    border-radius: 12px;
    background: var(--ink);
    color: var(--paper);
    font: inherit;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    flex-shrink: 0;
  }

  .sheet-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .btn-secondary,
  .btn-primary,
  .btn-danger {
    flex: 1;
    padding: 13px;
    border: none;
    border-radius: 12px;
    font: inherit;
    font-size: 13.5px;
    font-weight: 700;
    letter-spacing: -0.005em;
    cursor: pointer;
    transition: transform .15s var(--ease), filter .15s var(--ease);
  }
  .btn-secondary { background: var(--paper-2); color: var(--ink); }
  .btn-secondary:hover { background: var(--hairline-2); }
  .btn-primary { background: var(--ink); color: var(--paper); }
  .btn-primary:hover { filter: brightness(1.1); }
  .btn-danger { background: var(--danger); color: #fff; }
  .btn-danger:hover:not(:disabled) { filter: brightness(1.05); }
  .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary:active, .btn-primary:active, .btn-danger:active:not(:disabled) {
    transform: scale(.97);
  }

  @media (min-width: 500px) {
    .overlay { align-items: center; }
    .sheet {
      border-radius: 24px;
      max-width: 400px;
      padding: 24px 24px 20px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .shared-screen, .spinner, .live-dot, .overlay, .sheet, .menu {
      animation: none;
      transition: none;
    }
  }
</style>