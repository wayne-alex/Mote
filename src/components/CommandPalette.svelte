<script>
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { deriveDisplayTitle, noteMatchesQuery } from '../lib/notes.js';

  const dispatch = createEventDispatcher();

  export let notes = [];

  let query = '';
  let inputEl = null;
  let activeIndex = 0;

  // Static commands — always available
  const STATIC_COMMANDS = [
    {
      id: 'new-doc',
      title: 'New note',
      subtitle: 'Start writing',
      icon: 'file',
      run: () => dispatch('command', 'new-doc'),
    },
    {
      id: 'new-todo',
      title: 'New to-do list',
      subtitle: 'Checklist with items',
      icon: 'check',
      run: () => dispatch('command', 'new-todo'),
    },
    {
      id: 'new-bucket',
      title: 'New bucket list',
      subtitle: 'Things to do someday',
      icon: 'star',
      run: () => dispatch('command', 'new-bucket'),
    },
    {
      id: 'open-trash',
      title: 'Open trash',
      subtitle: 'Restore or permanently delete',
      icon: 'trash',
      run: () => dispatch('command', 'open-trash'),
    },
    {
      id: 'open-settings',
      title: 'Open settings',
      subtitle: 'Theme, text size, storage',
      icon: 'gear',
      run: () => dispatch('command', 'open-settings'),
    },
    {
      id: 'toggle-theme',
      title: 'Toggle theme',
      subtitle: 'Light ↔ dark',
      icon: 'moon',
      run: () => dispatch('command', 'toggle-theme'),
    },
  ];

  onMount(async () => {
    await tick();
    inputEl?.focus();
  });

  function close() {
    dispatch('close');
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, flat.length - 1);
      scrollIntoView();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      scrollIntoView();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[activeIndex];
      if (item) runItem(item);
    }
  }

  function scrollIntoView() {
    tick().then(() => {
      const el = document.querySelector(`[data-idx="${activeIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  function runItem(item) {
    item.run();
    close();
  }

  // Filter notes and commands by query
  $: q = query.trim().toLowerCase();

  $: filteredCommands = q
    ? STATIC_COMMANDS.filter(
        (c) => c.title.toLowerCase().includes(q) || c.subtitle.toLowerCase().includes(q)
      )
    : STATIC_COMMANDS;

  $: filteredNotes = q
    ? notes.filter((n) => noteMatchesQuery(n, q)).slice(0, 8)
    : notes.slice(0, 6);

  $: flat = [
    ...filteredCommands.map((c) => ({ ...c, type: 'command' })),
    ...filteredNotes.map((n) => ({
      id: `note-${n.id}`,
      title: deriveDisplayTitle(n),
      subtitle: 'Open note',
      icon: n.kind === 'list' ? 'check' : 'file',
      type: 'note',
      noteId: n.id,
      run: () => dispatch('command', { openNote: n.id }),
    })),
  ];

  $: {
    if (activeIndex >= flat.length) activeIndex = Math.max(0, flat.length - 1);
  }

  function iconPath(name) {
    switch (name) {
      case 'file':
        return 'M6 3.5 H15 L19 7.5 V20.5 H6 Z M15 3.5 V7.5 H19 M9 12 H15 M9 15.5 H15';
      case 'check':
        return 'M5 7 H10 M5 12 H10 M5 17 H10 M14 7 L16 9 L20 5 M14 12 L16 14 L20 10 M14 17 L16 19 L20 15';
      case 'star':
        return 'M12 3 L14.6 8.6 L20.8 9.3 L16.2 13.4 L17.4 19.4 L12 16.4 L6.6 19.4 L7.8 13.4 L3.2 9.3 L9.4 8.6 Z';
      case 'trash':
        return 'M3 6 H21 M8 6 V4 A2 2 0 0 1 10 2 H14 A2 2 0 0 1 16 4 V6 M6 6 L7 20 A2 2 0 0 0 9 22 H15 A2 2 0 0 0 17 20 L18 6';
      case 'gear':
        return 'M12 8 A4 4 0 1 0 12 16 A4 4 0 0 0 12 8 Z M19 12 A7 7 0 0 0 18.8 10 L21 8.5 L19 5 L16.4 6.2 A7 7 0 0 0 14 5 L13.8 2 H10.2 L10 5 A7 7 0 0 0 7.6 6.2 L5 5 L3 8.5 L5.2 10 A7 7 0 0 0 5.2 14 L3 15.5 L5 19 L7.6 17.8 A7 7 0 0 0 10 19 L10.2 22 H13.8 L14 19 A7 7 0 0 0 16.4 17.8 L19 19 L21 15.5 L18.8 14 A7 7 0 0 0 19 12 Z';
      case 'moon':
        return 'M21 12.8 A9 9 0 1 1 11.2 3 A7 7 0 0 0 21 12.8 Z';
      default:
        return '';
    }
  }
</script>

<div class="overlay" on:click={close} on:keydown role="presentation">
  <div class="palette" on:click|stopPropagation on:keydown role="dialog" aria-modal="true">
    <div class="search-row">
      <svg class="search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7"/>
        <path d="M20 20 L16 16"/>
      </svg>
      <input
        bind:this={inputEl}
        bind:value={query}
        on:keydown={onKeydown}
        class="input"
        type="text"
        placeholder="Search notes or run a command…"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
      />
      <kbd class="esc-hint">Esc</kbd>
    </div>

    <div class="results">
      {#if flat.length === 0}
        <div class="no-results">No matches for "{query}"</div>
      {:else}
        {#each flat as item, i (item.id)}
          <button
            class="item"
            class:active={i === activeIndex}
            data-idx={i}
            on:click={() => runItem(item)}
            on:mouseenter={() => (activeIndex = i)}
          >
            <span class="item-icon">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
                   stroke="currentColor" stroke-width="1.9"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d={iconPath(item.icon)}/>
              </svg>
            </span>
            <span class="item-body">
              <span class="item-title">{item.title || 'Untitled'}</span>
              <span class="item-sub">{item.subtitle}</span>
            </span>
          </button>
        {/each}
      {/if}
    </div>

    <div class="footer">
      <span class="footer-hint"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
      <span class="footer-hint"><kbd>↵</kbd> open</span>
      <span class="footer-hint"><kbd>Esc</kbd> close</span>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 250;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 14vh 20px 20px;
    background: var(--overlay);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    animation: fadeUp .18s var(--ease) both;
  }

  .palette {
    width: 100%;
    max-width: 520px;
    background: var(--surface);
    border-radius: 16px;
    box-shadow: var(--shadow-3), 0 0 0 1px var(--hairline);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    max-height: 66vh;
    animation: scaleIn .2s var(--ease) both;
  }

  @keyframes scaleIn {
    from { opacity: 0; transform: scale(.97) translateY(-6px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes fadeUp {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* ══════════════ SEARCH ══════════════ */
  .search-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--hairline);
    flex-shrink: 0;
  }
  .search-icon {
    color: var(--ink-3);
    flex-shrink: 0;
  }
  .input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 15.5px;
    font-weight: 500;
    letter-spacing: -0.01em;
    padding: 0;
  }
  .input::placeholder { color: var(--ink-4); font-weight: 400; }

  .esc-hint {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 6px;
    border-radius: 5px;
    background: var(--paper-2);
    color: var(--ink-3);
    border: 1px solid var(--hairline);
    flex-shrink: 0;
  }

  /* ══════════════ RESULTS ══════════════ */
  .results {
    overflow-y: auto;
    padding: 8px;
    flex: 1;
    min-height: 0;
  }

  .item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background .1s var(--ease);
  }
  .item.active { background: var(--paper-2); }
  .item:active { transform: scale(.99); }

  .item-icon {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: var(--paper-2);
    color: var(--ink-2);
    flex-shrink: 0;
  }
  .item.active .item-icon {
    background: var(--surface);
    color: var(--accent);
  }

  .item-body {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .item-title {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item-sub {
    font-size: 11.5px;
    color: var(--ink-3);
    letter-spacing: -0.005em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .no-results {
    padding: 32px 16px;
    text-align: center;
    color: var(--ink-3);
    font-size: 13px;
  }

  /* ══════════════ FOOTER ══════════════ */
  .footer {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 16px;
    border-top: 1px solid var(--hairline);
    background: var(--paper-2);
    flex-shrink: 0;
  }
  .footer-hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    font-weight: 500;
    color: var(--ink-3);
    letter-spacing: -0.005em;
  }
  .footer-hint kbd {
    font-family: var(--font-mono);
    font-size: 9.5px;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--surface);
    border: 1px solid var(--hairline-2);
    color: var(--ink-2);
    min-width: 16px;
    text-align: center;
  }

  @media (max-width: 500px) {
    .overlay { padding: 8vh 12px 12px; }
    .palette { max-height: 76vh; }
  }
</style>