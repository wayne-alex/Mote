<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import SwipeRow from './SwipeRow.svelte';
  import { prefs } from '../lib/prefs.js';
  import { authUser } from '../lib/auth.js';
  import { listRememberedShared } from '../lib/shared-store.js';
  import {
    deriveDisplayTitle,
    derivePreview,
    deriveMatchSnippet,
    formatUpdated,
    noteMatchesQuery,
    sortNotes,
  } from '../lib/notes.js';

  const dispatch = createEventDispatcher();

  export let notes = [];
  export let loading = false;
  export let trashCount = 0;

  const SS_KEY = 'mote:listState';

  function loadState() {
    try {
      const raw = sessionStorage.getItem(SS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  }

  const initial = loadState();
  let query = initial.query || '';
  let activeTag = initial.activeTag || '';
  let sort = initial.sort || $prefs.defaultSort || 'updated';
  let userChoseSort = !!initial.sort;

  let searchInputEl = null;
  let longPressTimer = null;
  let pressedId = null;
  let confirmDeleteId = null;
  let sortMenuOpen = false;
  let scrolled = false;

  $: {
    try {
      sessionStorage.setItem(SS_KEY, JSON.stringify({ query, activeTag, sort }));
    } catch {}
  }

  $: if (!userChoseSort && $prefs.defaultSort && $prefs.defaultSort !== sort) {
    sort = $prefs.defaultSort;
  }

  $: rememberedShared = listRememberedShared();

  onMount(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && document.activeElement === searchInputEl) {
        query = '';
        searchInputEl?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── Derived ────────────────────────────────────────────
  $: allTags = collectTags(notes);

  $: filtered = notes
    .filter((n) => (activeTag ? (n.tags || []).includes(activeTag) : true))
    .filter((n) => noteMatchesQuery(n, query));

  $: sorted = sortNotes(filtered, sort);

  $: totalCount = notes.length;
  $: isFiltering = !!(query.trim() || activeTag);
  $: hasAnyNotes = notes.length > 0;

  function collectTags(list) {
    const counts = new Map();
    for (const n of list) {
      for (const t of n.tags || []) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }

  // ── Actions ────────────────────────────────────────────
  function onScroll(e) {
    scrolled = e.currentTarget.scrollTop > 4;
  }

  function clearFilters() {
    query = '';
    activeTag = '';
  }

  function onPointerDown(note) {
    pressedId = note.id;
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      if (pressedId === note.id) {
        confirmDeleteId = note.id;
        if (navigator.vibrate) navigator.vibrate(15);
      }
    }, 600);
  }

  function onPointerUp() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    pressedId = null;
  }

  function onPointerCancel() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    pressedId = null;
  }

  function openNote(note) {
    if (confirmDeleteId === note.id) return;
    dispatch('open', note.id);
  }

  function confirmDelete() {
    const id = confirmDeleteId;
    confirmDeleteId = null;
    if (id) dispatch('delete', id);
  }

  function cancelDelete() {
    confirmDeleteId = null;
  }

  function kindLabel(note) {
    if (note.kind === 'list') {
      switch (note.listStyle) {
        case 'bucket':    return 'Bucket';
        case 'shopping':  return 'Shopping';
        case 'checklist': return 'Checklist';
        default:          return 'To-do';
      }
    }
    return null;
  }

  function selectTag(tag) {
    activeTag = activeTag === tag ? '' : tag;
  }

  function chooseSort(value) {
    sort = value;
    userChoseSort = true;
    sortMenuOpen = false;
  }

  function openShared(token) {
    dispatch('open-shared', token);
  }

  function newSharedList() {
    dispatch('new-shared');
  }
</script>

<!-- App shell: locked to the screen. Only .scroll moves. -->
<div class="app">

  <!-- ══════════════ PINNED TOP ══════════════ -->
  <div class="top" class:scrolled>

    <!-- HEADER -->
    <header class="head">
      <div class="head-left">
        <h1 class="brand">Mote</h1>
        <p class="sub">
          {#if isFiltering}
            {sorted.length} of {totalCount}
          {:else}
            {totalCount} {totalCount === 1 ? 'note' : 'notes'}
          {/if}
        </p>
      </div>
      <div class="head-actions">
        <button
          class="icon-action"
          on:click={newSharedList}
          aria-label="New shared list"
          title="New shared list"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
               stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="8" r="3.2"/>
            <path d="M3 20 C3 16.5 5.7 14 9 14 C12.3 14 15 16.5 15 20"/>
            <path d="M18 8 V14 M15 11 H21"/>
          </svg>
        </button>

        <button class="icon-action" on:click={() => dispatch('settings')} aria-label="Settings">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
               stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3.2"/>
            <path d="M19.4 15 A1.65 1.65 0 0 0 19.8 16.8 L19.9 16.9 A2 2 0 1 1 17 19.8 L16.9 19.7 A1.65 1.65 0 0 0 15.1 19.3 A1.65 1.65 0 0 0 14.2 20.8 V21 A2 2 0 1 1 10.2 21 V20.9 A1.65 1.65 0 0 0 9.3 19.4 A1.65 1.65 0 0 0 7.5 19.8 L7.4 19.9 A2 2 0 1 1 4.5 17 L4.6 16.9 A1.65 1.65 0 0 0 5 15.1 A1.65 1.65 0 0 0 3.5 14.2 H3.3 A2 2 0 1 1 3.3 10.2 H3.4 A1.65 1.65 0 0 0 4.9 9.3 A1.65 1.65 0 0 0 4.5 7.5 L4.4 7.4 A2 2 0 1 1 7.3 4.5 L7.4 4.6 A1.65 1.65 0 0 0 9.2 5 H9.3 A1.65 1.65 0 0 0 10.2 3.5 V3.3 A2 2 0 1 1 14.2 3.3 V3.4 A1.65 1.65 0 0 0 15.1 4.9 A1.65 1.65 0 0 0 16.9 4.5 L17 4.4 A2 2 0 1 1 19.9 7.3 L19.8 7.4 A1.65 1.65 0 0 0 19.4 9.2 V9.3 A1.65 1.65 0 0 0 20.9 10.2 H21.1 A2 2 0 1 1 21.1 14.2 H21 A1.65 1.65 0 0 0 19.4 15 Z"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- SEARCH + SORT -->
    {#if hasAnyNotes}
      <div class="search-row">
        <div class="search">
          <svg class="search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7"/>
            <path d="M20 20 L16 16"/>
          </svg>
          <input
            bind:this={searchInputEl}
            bind:value={query}
            class="search-input"
            type="search"
            placeholder="Search notes"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
          />
          {#if query}
            <button class="clear-btn" on:click={() => (query = '')} aria-label="Clear search">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                   stroke="currentColor" stroke-width="2.4"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 6 L18 18 M18 6 L6 18"/>
              </svg>
            </button>
          {/if}
        </div>

        <button
          class="sort-btn"
          class:active={sort !== $prefs.defaultSort}
          on:click={() => (sortMenuOpen = !sortMenuOpen)}
          aria-label="Sort"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6 H21 M6 12 H18 M9 18 H15"/>
          </svg>
        </button>

        {#if sortMenuOpen}
          <div class="sort-menu">
            <button
              class:selected={sort === 'updated'}
              on:click={() => chooseSort('updated')}
            >
              Recently edited
            </button>
            <button
              class:selected={sort === 'created'}
              on:click={() => chooseSort('created')}
            >
              Recently created
            </button>
            <button
              class:selected={sort === 'title'}
              on:click={() => chooseSort('title')}
            >
              Title A → Z
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <!-- TAG FILTER ROW -->
    {#if allTags.length > 0}
      <div class="tags-row">
        <div class="tag-scroll">
          {#if activeTag}
            <button class="tag-chip clear" on:click={() => (activeTag = '')}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none"
                   stroke="currentColor" stroke-width="2.6"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 6 L18 18 M18 6 L6 18"/>
              </svg>
              Clear
            </button>
          {/if}
          {#each allTags as tag}
            <button
              class="tag-chip"
              class:selected={activeTag === tag.name}
              on:click={() => selectTag(tag.name)}
            >
              #{tag.name}
              <span class="tag-count">{tag.count}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <!-- ══════════════ SCROLLING AREA ══════════════ -->
  <div class="scroll" on:scroll={onScroll}>

    <!-- SHARED LISTS -->
    {#if $authUser && rememberedShared.length > 0}
      <div class="shared-section">
        <div class="shared-head">
          <span class="shared-title">Shared with you</span>
          <span class="shared-count">{rememberedShared.length}</span>
        </div>
        <div class="shared-scroll">
          {#each rememberedShared as item (item.token)}
            <button class="shared-card" on:click={() => openShared(item.token)}>
              <div class="shared-card-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                     stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 7 H10 M5 12 H10 M5 17 H10"/>
                  <path d="M14 7 L16 9 L20 5"/>
                  <path d="M14 12 L16 14 L20 10"/>
                  <path d="M14 17 L16 19 L20 15"/>
                </svg>
              </div>
              <div class="shared-card-body">
                <div class="shared-card-title">{item.title || 'Untitled list'}</div>
                <div class="shared-card-sub">
                  {item.role === 'owner' ? 'Owned by you' : 'Shared with you'}
                </div>
              </div>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- CONTENT -->
    {#if loading}
      <div class="loading">
        <div class="spinner"></div>
      </div>

    {:else if !hasAnyNotes}
      <div class="empty">
        <div class="empty-mark">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"
               stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3 V21 M3 12 H21"/>
          </svg>
        </div>
        <h2 class="empty-title">Your first note</h2>
        <p class="empty-text">
          Tap the plus to begin. Everything you write stays on your device.
        </p>
        <button class="empty-btn" on:click={() => dispatch('create')}>New note</button>
      </div>

    {:else if sorted.length === 0}
      <div class="empty">
        <div class="empty-mark">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"
               stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7"/>
            <path d="M20 20 L16 16"/>
          </svg>
        </div>
        <h2 class="empty-title">No matches</h2>
        <p class="empty-text">
          {#if query}
            Nothing matches "{query}"
          {:else if activeTag}
            Nothing tagged <strong>#{activeTag}</strong>
          {/if}
        </p>
        <button class="empty-btn" on:click={clearFilters}>Clear filters</button>
      </div>

    {:else}
      <ul class="notes">
        {#each sorted as note (note.id)}
          <li>
            <SwipeRow
              variant="delete"
              deleteLabel="Delete"
              on:delete={() => dispatch('delete', note.id)}
            >
              <button
                type="button"
                class="note"
                class:pressing={pressedId === note.id}
                on:click={() => openNote(note)}
                on:pointerdown={() => onPointerDown(note)}
                on:pointerup={onPointerUp}
                on:pointerleave={onPointerCancel}
                on:pointercancel={onPointerCancel}
                on:contextmenu|preventDefault={() => (confirmDeleteId = note.id)}
              >
                <div class="note-top">
                  <h3 class="note-title">{deriveDisplayTitle(note)}</h3>
                  {#if kindLabel(note)}
                    <span class="note-kind">{kindLabel(note)}</span>
                  {/if}
                </div>

                {#if query && deriveMatchSnippet(note, query)}
                  {@const snip = deriveMatchSnippet(note, query)}
                  <p class="note-preview">
                    {snip.before}<mark>{snip.match}</mark>{snip.after}
                  </p>
                {:else}
                  <p class="note-preview">{derivePreview(note)}</p>
                {/if}

                <div class="note-meta">
                  <span class="meta-time">{formatUpdated(note.updatedAt)}</span>
                  {#if note.tags && note.tags.length > 0}
                    <span class="meta-sep">·</span>
                    <span class="meta-tags">
                      {#each note.tags.slice(0, 3) as t}
                        <span class="meta-tag">#{t}</span>
                      {/each}
                      {#if note.tags.length > 3}
                        <span class="meta-tag-more">+{note.tags.length - 3}</span>
                      {/if}
                    </span>
                  {/if}
                </div>
              </button>
            </SwipeRow>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- ══════════════ FLOATING ACTION BUTTON ══════════════ -->
  <!-- Sibling of .scroll inside the fixed shell, so it never moves. -->
  <button class="fab" on:click={() => dispatch('create')} aria-label="New note">
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
         stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 5 V19 M5 12 H19"/>
    </svg>
  </button>

</div>

<!-- ══════════════ DELETE CONFIRM ══════════════ -->
{#if confirmDeleteId}
  <div class="overlay" on:click={cancelDelete} on:keydown role="presentation">
    <div class="confirm" on:click|stopPropagation on:keydown role="dialog" aria-modal="true">
      <h3 class="confirm-title">Delete this note?</h3>
      <p class="confirm-text">
        It moves to Trash. You can restore it from there.
      </p>
      <div class="confirm-actions">
        <button class="confirm-btn secondary" on:click={cancelDelete}>Cancel</button>
        <button class="confirm-btn danger" on:click={confirmDelete}>Delete</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ══════════════ APP SHELL ══════════════ */
  /* No animation or transform on .app: either would turn it into the
     containing block for fixed descendants and break the layout. */
  .app {
    position: fixed;
    inset: 0;
    width: min(100%, 640px);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--paper);
  }

  .top {
    flex: 0 0 auto;
    position: relative;
    z-index: 10; /* keeps the sort menu above the scrolling list */
    padding: calc(16px + env(safe-area-inset-top)) 20px 0;
    background: var(--paper);
    border-bottom: 1px solid transparent;
    transition: border-color .2s var(--ease);
  }
  .top.scrolled { border-bottom-color: var(--hairline); }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    -webkit-overflow-scrolling: touch;
    padding: 12px 20px calc(100px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    scrollbar-width: none;
  }
  .scroll::-webkit-scrollbar { display: none; }

  /* Fade-in on content only, never on the shell */
  .notes, .empty, .shared-section {
    flex-shrink: 0;
    animation: fadeUp .35s var(--ease) both;
  }
  .empty { flex-shrink: 1; }

  /* ══════════════ HEADER ══════════════ */
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 20px;
    padding: 4px 4px 0;
  }
  .head-left { min-width: 0; flex: 1; }
  .brand {
    margin: 0 0 4px;
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.04em;
    line-height: 1;
    color: var(--ink);
  }
  .sub {
    margin: 0;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--ink-3);
    letter-spacing: -0.005em;
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .icon-action {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--hairline);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink-2);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background .15s var(--ease),
      color .15s var(--ease),
      border-color .15s var(--ease),
      transform .15s var(--ease);
  }
  .icon-action:hover {
    background: var(--paper-2);
    color: var(--ink);
    border-color: var(--hairline-2);
  }
  .icon-action:active { transform: scale(.94); }

  /* ══════════════ SEARCH + SORT ══════════════ */
  .search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    position: relative;
  }

  .search {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px 12px;
    border: 1px solid var(--hairline);
    border-radius: 12px;
    background: var(--surface);
    transition: border-color .15s var(--ease), box-shadow .2s var(--ease);
  }
  .search:focus-within {
    border-color: var(--ink);
    box-shadow: 0 0 0 3px var(--hairline-2);
  }

  .search-icon {
    color: var(--ink-3);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    font-size: 16px; /* 16px stops iOS zooming the page on focus */
    letter-spacing: -0.005em;
    color: var(--ink);
    padding: 0;
    -webkit-appearance: none;
    appearance: none;
  }
  .search-input::-webkit-search-cancel-button { display: none; }
  .search-input::placeholder { color: var(--ink-4); }

  .clear-btn {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: var(--paper-2);
    color: var(--ink-2);
    cursor: pointer;
    padding: 0;
    transition: background .15s var(--ease);
  }
  .clear-btn:hover { background: var(--hairline-2); }

  .sort-btn {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--hairline);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink-2);
    cursor: pointer;
    transition: background .15s var(--ease), border-color .15s var(--ease), color .15s var(--ease);
  }
  .sort-btn:hover { background: var(--paper-2); }
  .sort-btn.active {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--paper);
  }

  .sort-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 20;
    min-width: 170px;
    padding: 6px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 12px;
    box-shadow: var(--shadow-3);
    display: flex;
    flex-direction: column;
    gap: 2px;
    animation: fadeUp .15s var(--ease) both;
  }
  .sort-menu button {
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
  .sort-menu button:hover { background: var(--paper-2); }
  .sort-menu button.selected {
    background: var(--ink);
    color: var(--paper);
    font-weight: 600;
  }

  /* ══════════════ SHARED SECTION ══════════════ */
  .shared-section {
    margin-bottom: 18px;
  }
  .shared-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 4px;
    margin-bottom: 10px;
  }
  .shared-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-3);
  }
  .shared-count {
    font-size: 10.5px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--paper-2);
    color: var(--ink-3);
  }
  .shared-scroll {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding: 2px 4px 8px;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .shared-scroll::-webkit-scrollbar { display: none; }
  .shared-card {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 220px;
    max-width: 260px;
    padding: 12px 14px;
    border: 1px solid var(--hairline);
    border-radius: 14px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: transform .15s var(--ease), border-color .15s var(--ease), box-shadow .15s var(--ease);
  }
  .shared-card:hover {
    transform: translateY(-1px);
    border-color: var(--hairline-2);
    box-shadow: var(--shadow-2);
  }
  .shared-card-icon {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent);
    flex-shrink: 0;
  }
  .shared-card-body { min-width: 0; flex: 1; }
  .shared-card-title {
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .shared-card-sub {
    font-size: 11px;
    color: var(--ink-3);
    margin-top: 2px;
    letter-spacing: -0.005em;
  }

  /* ══════════════ TAGS ROW ══════════════ */
  .tags-row {
    margin-bottom: 8px;
    overflow: hidden;
  }
  .tag-scroll {
    display: flex;
    flex-wrap: nowrap;
    gap: 6px;
    overflow-x: auto;
    padding: 2px 2px 6px;
    scroll-snap-type: x proximity;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .tag-scroll::-webkit-scrollbar { display: none; }

  .tag-chip {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 11px;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink-2);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: -0.005em;
    cursor: pointer;
    white-space: nowrap;
    transition: background .15s var(--ease), border-color .15s var(--ease), color .15s var(--ease);
  }
  .tag-chip:hover { background: var(--paper-2); }
  .tag-chip.selected {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--paper);
  }
  .tag-chip.selected .tag-count {
    background: rgba(255, 255, 255, .18);
    color: var(--paper);
  }
  .tag-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--paper-2);
    color: var(--ink-3);
    font-size: 10px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .tag-chip.clear {
    background: transparent;
    border-style: dashed;
    color: var(--ink-3);
  }
  .tag-chip.clear:hover {
    background: var(--paper-2);
    color: var(--ink-2);
  }

  /* ══════════════ NOTES ══════════════ */
  .notes {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .note {
    width: 100%;
    display: block;
    padding: 14px 16px;
    border: 1px solid var(--hairline);
    border-radius: 16px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      transform .18s var(--ease),
      box-shadow .2s var(--ease),
      border-color .2s var(--ease),
      background-color .25s var(--ease);
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .note:hover {
    transform: translateY(-1px);
    border-color: var(--hairline-2);
    box-shadow: var(--shadow-2);
  }
  .note.pressing {
    transform: scale(.985);
    background: var(--paper-2);
  }

  .note-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
  }
  .note-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .note-kind {
    font-size: 9.5px;
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 3px 8px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    flex-shrink: 0;
  }
  .note-preview {
    margin: 0 0 8px;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    letter-spacing: -0.005em;
  }
  .note-preview mark {
    background: var(--accent-soft);
    color: var(--ink);
    padding: 0 2px;
    border-radius: 3px;
    font-weight: 600;
  }
  .note-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    font-weight: 500;
    color: var(--ink-4);
    letter-spacing: 0.01em;
    min-width: 0;
  }
  .meta-time { flex-shrink: 0; }
  .meta-sep { color: var(--ink-4); }
  .meta-tags {
    display: inline-flex;
    gap: 5px;
    overflow: hidden;
    min-width: 0;
  }
  .meta-tag { color: var(--ink-3); }
  .meta-tag-more { color: var(--ink-4); }

  /* ══════════════ FAB ══════════════ */
  /* Absolute inside the fixed .app shell, outside the scroller,
     so it stays put while the list scrolls. */
  .fab {
    position: absolute;
    right: 20px;
    bottom: calc(20px + env(safe-area-inset-bottom));
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 18px;
    background: var(--ink);
    color: var(--paper);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    box-shadow:
      0 12px 28px -8px rgba(10, 10, 10, .35),
      0 4px 12px -2px rgba(10, 10, 10, .2),
      inset 0 1px 0 rgba(255, 255, 255, .12);
    transition:
      transform .2s cubic-bezier(.32, .72, 0, 1),
      box-shadow .25s cubic-bezier(.32, .72, 0, 1);
    z-index: 30;
  }
  .fab:hover {
    transform: translateY(-2px);
    box-shadow:
      0 16px 36px -8px rgba(10, 10, 10, .4),
      0 6px 16px -2px rgba(10, 10, 10, .22),
      inset 0 1px 0 rgba(255, 255, 255, .14);
  }
  .fab:active { transform: scale(.94); }

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
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.025em;
    color: var(--ink);
  }
  .empty-text {
    margin: 6px 0 20px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink-3);
    max-width: 260px;
  }
  .empty-btn {
    padding: 11px 22px;
    border: none;
    border-radius: 11px;
    background: var(--ink);
    color: var(--paper);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition: transform .18s var(--ease);
  }
  .empty-btn:active { transform: scale(.97); }

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

  /* ══════════════ CONFIRM SHEET ══════════════ */
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

  @media (prefers-reduced-motion: reduce) {
    .notes, .note, .empty, .empty-btn, .confirm, .overlay, .spinner,
    .sort-menu, .shared-section, .fab {
      animation: none;
      transition: none;
    }
  }
</style>