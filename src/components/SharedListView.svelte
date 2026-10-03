<script>
  import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
  import { authUser } from '../lib/auth.js';
  import {
    watchSharedList,
    joinSharedList,
    updateSharedTitle,
    updateSharedList,
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

  // Pending per-item text edits (avoid a network write per keystroke)
  const ITEM_DEBOUNCE_MS = 400;
  const pendingItems = new Map(); // id -> { text, timer }

  // Menu / sheets
  let menuOpen = false;
  let shareSheetOpen = false;
  let shareCopied = false;
  let revokeConfirmOpen = false;
  let busy = false;
  let scrolled = false;

  // Viewport / keyboard (keeps the shell above the on-screen keyboard)
  let vvHeight = 0;
  let vvTop = 0;

  function syncViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    vvHeight = vv.height;
    vvTop = vv.offsetTop;
  }

  $: appStyle = vvHeight
    ? `top:${vvTop}px;height:${vvHeight}px;bottom:auto;`
    : '';

  onMount(() => {
    syncViewport();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', syncViewport);
    vv?.addEventListener('scroll', syncViewport);
    return () => {
      vv?.removeEventListener('resize', syncViewport);
      vv?.removeEventListener('scroll', syncViewport);
    };
  });

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
    flushAll();
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
  // FLUSHING (back button, app backgrounded, unmount)
  // ═══════════════════════════════════════════════════════════
  function flushTitle() {
    if (titleSaveTimer) {
      clearTimeout(titleSaveTimer);
      titleSaveTimer = null;
    }
    if (titleDirty && list) {
      return updateSharedTitle(token, titleBuffer.trim())
        .then(() => (titleDirty = false))
        .catch((err) => console.error('[shared] title save failed:', err));
    }
    return Promise.resolve();
  }

  function flushItems() {
    const jobs = [];
    for (const [id, entry] of pendingItems) {
      clearTimeout(entry.timer);
      jobs.push(
        updateItemTextInShared(token, id, entry.text).catch((err) => console.error(err))
      );
    }
    pendingItems.clear();
    return Promise.all(jobs);
  }

  function flushAll() {
    return Promise.all([flushTitle(), flushItems()]);
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') flushAll();
  }

  async function back() {
    await flushAll();
    dispatch('back');
  }

  function onScroll(e) {
    scrolled = e.currentTarget.scrollTop > 4;
  }

  // ═══════════════════════════════════════════════════════════
  // TITLE
  // ═══════════════════════════════════════════════════════════
  function onTitleInput() {
    titleDirty = true;
    if (titleSaveTimer) clearTimeout(titleSaveTimer);
    titleSaveTimer = setTimeout(async () => {
      titleSaveTimer = null;
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
    flushTitle();
  }

  // ═══════════════════════════════════════════════════════════
  // ITEMS
  // ═══════════════════════════════════════════════════════════
  function focusInput(index) {
    tick().then(() => {
      setTimeout(() => {
        const inputs = document.querySelectorAll('.item-input');
        const el = index < 0 ? inputs[inputs.length - 1] : inputs[index];
        el?.focus();
      }, 50);
    });
  }

  async function addItem() {
    if (!list) return;
    try {
      await addItemToShared(token, '');
      focusInput(-1);
    } catch (err) {
      console.error('[shared] add failed:', err);
    }
  }

  async function removeItem(itemId) {
    const entry = pendingItems.get(itemId);
    if (entry) {
      clearTimeout(entry.timer);
      pendingItems.delete(itemId);
    }
    try { await removeItemFromShared(token, itemId); }
    catch (err) { console.error(err); }
  }

  async function toggleItem(itemId) {
    if (navigator.vibrate) navigator.vibrate(8);
    try { await toggleItemInShared(token, itemId); }
    catch (err) { console.error(err); }
  }

  function onItemInput(itemId, text) {
    const existing = pendingItems.get(itemId);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      pendingItems.delete(itemId);
      updateItemTextInShared(token, itemId, text).catch((err) => console.error(err));
    }, ITEM_DEBOUNCE_MS);
    pendingItems.set(itemId, { text, timer });
  }

  function onItemBlur(itemId) {
    const entry = pendingItems.get(itemId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingItems.delete(itemId);
    updateItemTextInShared(token, itemId, entry.text).catch((err) => console.error(err));
  }

  async function insertItemAfter(index) {
    const current = list;
    if (!current) return;

    // Apply any not-yet-saved text so the insert doesn't overwrite it
    const items = (current.items || []).map((it) => {
      const entry = pendingItems.get(it.id);
      return entry ? { ...it, text: entry.text } : it;
    });
    for (const entry of pendingItems.values()) clearTimeout(entry.timer);
    pendingItems.clear();

    items.splice(index + 1, 0, {
      id: crypto.randomUUID(),
      text: '',
      done: false,
      doneAt: null,
    });

    try {
      await updateSharedList(token, { items });
      focusInput(index + 1);
    } catch (err) {
      console.error('[shared] insert failed:', err);
    }
  }

  function onItemKeydown(e, item, index) {
    if (e.key === 'Enter') {
      e.preventDefault();
      insertItemAfter(index);
    }
    if (e.key === 'Backspace' && !e.currentTarget.value) {
      e.preventDefault();
      removeItem(item.id);
      focusInput(Math.max(0, index - 1));
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

<svelte:window on:pagehide={flushAll} />
<svelte:document on:visibilitychange={onVisibility} />

<!-- App shell: locked to the visible screen (shrinks above the keyboard). -->
<div class="app" style={appStyle}>

  <!-- ══════════════ HEADER ══════════════ -->
  <header class="head" class:scrolled>
    <button class="icon-btn" on:click={back} aria-label="Back">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
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

    <button class="icon-btn" on:click={() => (menuOpen = !menuOpen)} aria-label="Options">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="6" r="1"/>
        <circle cx="12" cy="12" r="1"/>
        <circle cx="12" cy="18" r="1"/>
      </svg>
    </button>

    {#if menuOpen}
      <!-- Invisible scrim: tap anywhere outside to close the menu -->
      <div class="menu-scrim" on:click={() => (menuOpen = false)} on:keydown role="presentation"></div>
      <div class="menu">
        <button on:click={openShareSheet}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
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
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6 H21 M8 6 V4 A2 2 0 0 1 10 2 H14 A2 2 0 0 1 16 4 V6 M6 6 L7 20 A2 2 0 0 0 9 22 H15 A2 2 0 0 0 17 20 L18 6"/>
            </svg>
            Delete list
          </button>
        {/if}
      </div>
    {/if}
  </header>

  <!-- ══════════════ SCROLLING BODY ══════════════ -->
  <div class="scroll" on:scroll={onScroll}>
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
        <button class="btn-secondary solo" on:click={() => dispatch('back')}>Go back</button>
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
        <button class="btn-secondary solo" on:click={() => dispatch('back')}>Go back</button>
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
          autocapitalize="sentences"
          spellcheck="false"
          enterkeyhint="next"
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
                on:input={(e) => onItemInput(item.id, e.currentTarget.value)}
                on:blur={() => onItemBlur(item.id)}
                on:keydown={(e) => onItemKeydown(e, item, i)}
                placeholder="New item"
                autocomplete="off"
                autocapitalize="sentences"
                spellcheck="false"
                enterkeyhint="next"
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
  </div>
</div>

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

<style>
  /* ══════════════ APP SHELL ══════════════ */
  /* No transform/animation on .app. The inline style (top/height) tracks
     the visual viewport so the shell shrinks above the on-screen keyboard. */
  .app {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    width: min(100%, 720px);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--paper);
    color: var(--ink);
    -webkit-tap-highlight-color: transparent;
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── Header ─────────────────────────────── */
  .head {
    position: relative;
    z-index: 10;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: calc(8px + env(safe-area-inset-top)) 12px 8px;
    background: var(--paper);
    border-bottom: 1px solid transparent;
    transition: border-color .2s var(--ease);
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .head.scrolled { border-bottom-color: var(--hairline); }

  .icon-btn {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: var(--ink);
    cursor: pointer;
    flex-shrink: 0;
    touch-action: manipulation;
    transition: background .15s var(--ease), transform .15s var(--ease);
  }
  .icon-btn:active { background: var(--paper-2); transform: scale(.94); }
  @media (hover: hover) {
    .icon-btn:hover { background: var(--paper-2); }
  }

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
    white-space: nowrap;
  }

  .menu-scrim {
    position: fixed;
    inset: 0;
    z-index: 25;
  }
  .menu {
    position: absolute;
    top: calc(100% + 2px);
    right: 12px;
    z-index: 30;
    min-width: 190px;
    padding: 6px;
    border-radius: 14px;
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
    min-height: 44px;
    padding: 9px 12px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
    transition: background .1s var(--ease);
  }
  .menu button:active { background: var(--paper-2); }
  .menu button.danger { color: var(--danger); }
  @media (hover: hover) {
    .menu button:hover { background: var(--paper-2); }
  }

  /* ── Scroll area ────────────────────────── */
  .scroll {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .scroll::-webkit-scrollbar { display: none; }

  .body {
    flex-shrink: 0;
    padding: 16px 20px calc(60px + env(safe-area-inset-bottom));
    animation: fadeUp .3s var(--ease) both;
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
    margin-bottom: 16px;
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
    gap: 6px;
    min-height: 48px;
  }

  /* 44px tap target around a 22px visual box */
  .checkbox {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    padding: 0;
    cursor: pointer;
    touch-action: manipulation;
    position: relative;
    margin-left: -10px;
  }
  .checkbox::before {
    content: '';
    width: 22px;
    height: 22px;
    border: 1.5px solid var(--ink-4);
    border-radius: 7px;
    box-sizing: border-box;
    transition: background .18s var(--ease), border-color .18s var(--ease), transform .12s var(--ease);
  }
  .checkbox svg {
    position: absolute;
    color: #fff;
  }
  .checkbox:active::before { transform: scale(.9); }
  .checkbox.on::before {
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
    font-size: 16px; /* 16px stops iOS zooming the page on focus */
    color: var(--ink);
    padding: 8px 0;
    letter-spacing: -0.005em;
  }
  .item-input::placeholder { color: var(--ink-4); }
  .item.done .item-input {
    color: var(--ink-3);
    text-decoration: line-through;
    text-decoration-color: var(--ink-4);
  }

  .remove {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
    flex-shrink: 0;
    touch-action: manipulation;
    transition: opacity .15s var(--ease), background .15s var(--ease), color .15s var(--ease);
  }
  .remove:active { background: var(--paper-2); color: var(--danger); }

  /* Hover-reveal on desktop; always visible on touch (no hover there) */
  @media (hover: hover) {
    .remove { opacity: 0; }
    .item:hover .remove,
    .remove:focus-visible { opacity: 1; }
    .remove:hover { background: var(--paper-2); color: var(--danger); }
  }

  .add-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 9px 16px;
    border: 1px dashed var(--hairline-2);
    border-radius: 12px;
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
    transition: background .18s var(--ease), border-color .18s var(--ease), color .18s var(--ease), transform .12s var(--ease);
  }
  .add-item:active { background: var(--paper-2); transform: scale(.98); }
  @media (hover: hover) {
    .add-item:hover {
      background: var(--paper-2);
      border-color: var(--ink-4);
      color: var(--ink);
    }
  }

  /* ── Center states ─────────────────────── */
  .center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 24px calc(40px + env(safe-area-inset-bottom));
    text-align: center;
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
    font-size: 16px; /* 16px stops iOS zooming on focus */
    font-weight: 500;
  }
  .url-input:focus { outline: none; border-color: var(--accent); }
  .copy-btn {
    min-height: 46px;
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
    touch-action: manipulation;
    transition: transform .15s var(--ease);
  }
  .copy-btn:active { transform: scale(.96); }

  .sheet-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .btn-secondary,
  .btn-primary,
  .btn-danger {
    flex: 1;
    min-height: 46px;
    padding: 13px;
    border: none;
    border-radius: 12px;
    font: inherit;
    font-size: 13.5px;
    font-weight: 700;
    letter-spacing: -0.005em;
    cursor: pointer;
    touch-action: manipulation;
    transition: transform .15s var(--ease), filter .15s var(--ease), background .15s var(--ease);
  }
  .btn-secondary.solo { flex: 0 0 auto; padding: 13px 28px; }
  .btn-secondary { background: var(--paper-2); color: var(--ink); }
  .btn-primary { background: var(--ink); color: var(--paper); }
  .btn-danger { background: var(--danger); color: #fff; }
  .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary:active, .btn-primary:active, .btn-danger:active:not(:disabled) {
    transform: scale(.97);
  }
  @media (hover: hover) {
    .btn-secondary:hover { background: var(--hairline-2); }
    .btn-primary:hover { filter: brightness(1.1); }
    .btn-danger:hover:not(:disabled) { filter: brightness(1.05); }
  }

  @media (min-width: 500px) {
    .overlay { align-items: center; }
    .sheet {
      border-radius: 24px;
      max-width: 400px;
      padding: 24px 24px 20px;
    }
  }

  @media (min-width: 720px) {
    .body { padding: 28px 48px 80px; }
    .list-title { font-size: 30px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .body, .spinner, .live-dot, .overlay, .sheet, .menu { animation: none; }
    .head, .icon-btn, .checkbox::before, .add-item, .remove,
    .btn-secondary, .btn-primary, .btn-danger, .copy-btn { transition: none; }
  }
</style>