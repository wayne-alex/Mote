<script>
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { putNote } from '../lib/db.js';
  import {
    createListItem,
    deriveTitle,
    patchNote,
    wordCount,
    charCount,
    cleanTags,
    normalizeTag,
  } from '../lib/notes.js';
  import { renderMarkdown, hasMarkdownSyntax } from '../lib/markdown.js';

  const dispatch = createEventDispatcher();

  export let note = null;

  // ═══════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════
  let body = '';
  let title = '';
  let items = [];
  let status = 'idle';
  let lastSavedAt = null;
  let textareaEl = null;
  let statusTimer = null;
  let saveTimer = null;
  let currentNoteId = null;

  const SAVE_DEBOUNCE_MS = 400;
  const PREVIEW_KEY = 'mote:preview';

  let previewing = false;

  // Tag input
  let tagInputOpen = false;
  let tagInputValue = '';
  let tagInputEl = null;

  // ═══════════════════════════════════════════════════════════
  // PREVIEW PERSISTENCE
  // ═══════════════════════════════════════════════════════════
  function loadPreviewMap() {
    try {
      const raw = sessionStorage.getItem(PREVIEW_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function savePreviewMap(map) {
    try {
      sessionStorage.setItem(PREVIEW_KEY, JSON.stringify(map));
    } catch {}
  }

  function setPreviewFor(id, value) {
    const map = loadPreviewMap();
    map[id] = value;
    savePreviewMap(map);
  }

  function getPreviewFor(id) {
    return !!loadPreviewMap()[id];
  }

  // ═══════════════════════════════════════════════════════════
  // BOOT + NOTE SWAP
  // ═══════════════════════════════════════════════════════════
  onMount(async () => {
    if (!note) return;
    hydrateFromNote();
    await tick();
    textareaEl?.focus();
  });

  $: if (note && note.id !== currentNoteId) {
    currentNoteId = note.id;
    hydrateFromNote();
    previewing = note.kind === 'doc' ? getPreviewFor(note.id) : false;
    tick().then(() => textareaEl?.focus());
  }

  function hydrateFromNote() {
    if (!note) return;
    body = note.body || '';
    title = note.title || '';
    items = Array.isArray(note.items) ? [...note.items] : [];
  }

  // ═══════════════════════════════════════════════════════════
  // SAVE
  // ═══════════════════════════════════════════════════════════
  function scheduleSave() {
    if (!note) return;
    status = 'saving';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, SAVE_DEBOUNCE_MS);
  }

  async function doSave() {
    if (!note) return;
    try {
      const patch = note.kind === 'list'
        ? { title: title || deriveListTitle(), items }
        : { body, title: deriveTitle(body) };

      const updated = patchNote(note, patch);
      await putNote(updated);
      Object.assign(note, updated);
      lastSavedAt = new Date();
      status = 'saved';
      dispatch('saved', updated);

      if (statusTimer) clearTimeout(statusTimer);
      statusTimer = setTimeout(() => {
        if (status === 'saved') status = 'idle';
      }, 1200);
    } catch (err) {
      console.error('[save] failed:', err);
      status = 'error';
    }
  }

  function deriveListTitle() {
    const first = items.map((i) => i.text).find((t) => t && t.trim());
    return first ? first.slice(0, 80) : '';
  }

  // ═══════════════════════════════════════════════════════════
  // DOC EDITOR
  // ═══════════════════════════════════════════════════════════
  function onBodyInput() {
    scheduleSave();
  }

  function togglePreview() {
    if (!note || note.kind !== 'doc') return;
    if (!body.trim()) return;
    previewing = !previewing;
    setPreviewFor(note.id, previewing);
    if (!previewing) {
      tick().then(() => textareaEl?.focus());
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LIST EDITOR
  // ═══════════════════════════════════════════════════════════
  function onTitleInput() {
    scheduleSave();
  }

  function addItem() {
    items = [...items, createListItem('')];
    scheduleSave();
    tick().then(() => {
      const inputs = document.querySelectorAll('.item-input');
      inputs[inputs.length - 1]?.focus();
    });
  }

  function updateItemText(id, text) {
    items = items.map((it) => (it.id === id ? { ...it, text } : it));
    scheduleSave();
  }

  function toggleItem(id) {
    items = items.map((it) =>
      it.id === id
        ? { ...it, done: !it.done, doneAt: !it.done ? new Date().toISOString() : null }
        : it
    );
    scheduleSave();
  }

  function removeItem(id) {
    items = items.filter((it) => it.id !== id);
    scheduleSave();
  }

  function onItemKeydown(e, id) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const idx = items.findIndex((i) => i.id === id);
      const next = createListItem('');
      const copy = [...items];
      copy.splice(idx + 1, 0, next);
      items = copy;
      scheduleSave();
      tick().then(() => {
        const inputs = document.querySelectorAll('.item-input');
        inputs[idx + 1]?.focus();
      });
    }
    if (e.key === 'Backspace' && items.find((i) => i.id === id)?.text === '') {
      e.preventDefault();
      const idx = items.findIndex((i) => i.id === id);
      if (items.length <= 1) return;
      removeItem(id);
      tick().then(() => {
        const inputs = document.querySelectorAll('.item-input');
        inputs[Math.max(0, idx - 1)]?.focus();
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TAGS
  // ═══════════════════════════════════════════════════════════
  $: tags = note?.tags || [];

  function openTagInput() {
    tagInputOpen = true;
    tick().then(() => tagInputEl?.focus());
  }

  function closeTagInput() {
    tagInputOpen = false;
    tagInputValue = '';
  }

  async function commitTag() {
    if (!note) return;
    const t = normalizeTag(tagInputValue);
    if (!t) { closeTagInput(); return; }

    if ((note.tags || []).includes(t)) {
      tagInputValue = '';
      tick().then(() => tagInputEl?.focus());
      return;
    }

    const next = cleanTags([...(note.tags || []), t]);
    const updated = patchNote(note, { tags: next });
    await putNote(updated);
    Object.assign(note, updated);
    tagInputValue = '';
    dispatch('saved', updated);
    tick().then(() => tagInputEl?.focus());
  }

  async function removeTag(tag) {
    if (!note) return;
    const next = (note.tags || []).filter((t) => t !== tag);
    const updated = patchNote(note, { tags: next });
    await putNote(updated);
    Object.assign(note, updated);
    dispatch('saved', updated);
  }

  function onTagKeydown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitTag();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeTagInput();
    }
    if (e.key === 'Backspace' && !tagInputValue) {
      const last = (note?.tags || []).slice(-1)[0];
      if (last) removeTag(last);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DERIVED
  // ═══════════════════════════════════════════════════════════
  $: words = note?.kind === 'doc' ? wordCount(body) : 0;
  $: chars = note?.kind === 'doc' ? charCount(body) : 0;
  $: doneCount = note?.kind === 'list' ? items.filter((i) => i.done).length : 0;
  $: savedLabel = lastSavedAt
    ? lastSavedAt.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
    : '';
  $: previewHtml = previewing ? renderMarkdown(body) : '';
  $: canPreview = note?.kind === 'doc' && body.trim().length > 0;

  function back() {
    dispatch('back');
  }

  function onKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
      if (note?.kind === 'doc') {
        e.preventDefault();
        togglePreview();
      }
    }
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="editor-screen">

  <!-- ══════════════ HEADER ══════════════ -->
  <header class="head">
    <button class="back-btn" on:click={back} aria-label="Back">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 6 L9 12 L15 18"/>
      </svg>
    </button>

    <div class="head-center">
      {#if note?.kind === 'list'}
        <span class="kind-badge list">List</span>
      {:else}
        <span class="kind-badge doc">Note</span>
      {/if}
    </div>

    <div class="head-right">
      {#if note?.kind === 'doc'}
        <button
          class="preview-btn"
          class:active={previewing}
          disabled={!canPreview}
          on:click={togglePreview}
          aria-label={previewing ? 'Edit' : 'Preview'}
        >
          {#if previewing}
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20 H20"/>
              <path d="M16.5 3.5 A2.1 2.1 0 0 1 20.5 7.5 L7 21 H3 V17 Z"/>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12 C4.5 7 8 4.5 12 4.5 C16 4.5 19.5 7 22 12 C19.5 17 16 19.5 12 19.5 C8 19.5 4.5 17 2 12 Z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          {/if}
        </button>
      {/if}

      <div class="status-slot">
        {#if status === 'saving'}
          <span class="status saving">Saving…</span>
        {:else if status === 'saved'}
          <span class="status saved">Saved {savedLabel}</span>
        {:else if status === 'error'}
          <span class="status error">Save failed</span>
        {/if}
      </div>
    </div>
  </header>

  <!-- ══════════════ TAGS BAR ══════════════ -->
  {#if note}
    <div class="tags-bar">
      <div class="tags-scroll">
        {#each tags as t}
          <button class="editor-tag" on:click={() => removeTag(t)} type="button">
            #{t}
            <span class="editor-tag-x">×</span>
          </button>
        {/each}

        {#if tagInputOpen}
          <input
            bind:this={tagInputEl}
            bind:value={tagInputValue}
            on:keydown={onTagKeydown}
            on:blur={closeTagInput}
            class="tag-input"
            placeholder="tag name"
            autocomplete="off"
            spellcheck="false"
            maxlength="32"
          />
        {:else}
          <button class="add-tag" on:click={openTagInput} type="button">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none"
                 stroke="currentColor" stroke-width="2.4"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5 V19 M5 12 H19"/>
            </svg>
            {tags.length === 0 ? 'Add tag' : 'Tag'}
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- ══════════════ BODY ══════════════ -->
  {#if note?.kind === 'list'}
    <!-- LIST EDITOR -->
    <div class="list-editor">
      <input
        class="list-title"
        bind:value={title}
        on:input={onTitleInput}
        placeholder="List name"
        autocomplete="off"
        spellcheck="false"
      />

      <div class="list-meta">
        <span>{doneCount} of {items.length} done</span>
      </div>

      <ul class="items">
        {#each items as item (item.id)}
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
              on:keydown={(e) => onItemKeydown(e, item.id)}
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

  {:else if previewing}
    <!-- MARKDOWN PREVIEW -->
    <div class="preview-shell">
      <article class="markdown">
        {@html previewHtml}
      </article>
    </div>

    <footer class="foot">
      <div class="stats">
        <span>{words} {words === 1 ? 'word' : 'words'}</span>
        <span class="sep">·</span>
        <span>{chars} {chars === 1 ? 'char' : 'chars'}</span>
      </div>
      <div class="mode-hint">
        Preview · <kbd>⌘P</kbd> to edit
      </div>
    </footer>

  {:else}
    <!-- DOC EDITOR -->
    <div class="editor-shell">
      <textarea
        bind:this={textareaEl}
        bind:value={body}
        class="editor"
        placeholder="Start typing… Markdown is supported."
        spellcheck="true"
        on:input={onBodyInput}
      ></textarea>
    </div>

    <footer class="foot">
      <div class="stats">
        <span>{words} {words === 1 ? 'word' : 'words'}</span>
        <span class="sep">·</span>
        <span>{chars} {chars === 1 ? 'char' : 'chars'}</span>
      </div>
      {#if hasMarkdownSyntax(body)}
        <div class="mode-hint">
          Markdown · <kbd>⌘P</kbd> to preview
        </div>
      {/if}
    </footer>
  {/if}

</div>

<style>
  .editor-screen {
    width: min(100%, 720px);
    margin: 0 auto;
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    animation: fadeUp .3s var(--ease) both;
    background: var(--paper);
    color: var(--ink);
    transition: background-color .25s var(--ease), color .25s var(--ease);
  }

  /* ══════════════ HEADER ══════════════ */
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--hairline);
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
    transition: background .15s var(--ease), transform .15s var(--ease);
  }
  .back-btn:hover { background: var(--paper-2); }
  .back-btn:active { transform: scale(.94); }

  .head-center {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .kind-badge {
    font-size: 9.5px;
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 4px 10px;
    border-radius: 999px;
  }
  .kind-badge.doc  { background: var(--paper-2); color: var(--ink-2); }
  .kind-badge.list { background: var(--accent-soft); color: var(--accent); }

  .head-right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 34px;
  }

  .preview-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 9px;
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
    flex-shrink: 0;
    transition: background .15s var(--ease), color .15s var(--ease), transform .15s var(--ease);
  }
  .preview-btn:hover:not(:disabled) { background: var(--paper-2); }
  .preview-btn:active:not(:disabled) { transform: scale(.94); }
  .preview-btn.active {
    background: var(--ink);
    color: var(--paper);
  }
  .preview-btn:disabled {
    opacity: .3;
    cursor: not-allowed;
  }

  .status-slot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 60px;
  }

  .status {
    font-size: 11px;
    font-weight: 500;
    color: var(--ink-3);
    letter-spacing: -0.005em;
    transition: color .2s var(--ease);
    white-space: nowrap;
  }
  .status.saved { color: var(--accent); }
  .status.error { color: var(--danger); font-weight: 600; }

  /* ══════════════ TAGS BAR ══════════════ */
  .tags-bar {
    padding: 8px 16px;
    border-bottom: 1px solid var(--hairline);
    flex-shrink: 0;
    background: var(--paper-2);
  }

  .tags-scroll {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 6px;
    overflow-x: auto;
    padding: 2px 0 4px;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .tags-scroll::-webkit-scrollbar { display: none; }

  .editor-tag {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: -0.005em;
    cursor: pointer;
    transition: filter .15s var(--ease);
  }
  .editor-tag:hover { filter: brightness(.94); }
  .editor-tag:active { transform: scale(.97); }

  .editor-tag-x {
    font-size: 13px;
    line-height: 1;
    opacity: .55;
  }

  .add-tag {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border: 1px dashed var(--hairline-2);
    border-radius: 999px;
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: -0.005em;
    cursor: pointer;
    transition: background .15s var(--ease), border-color .15s var(--ease), color .15s var(--ease);
  }
  .add-tag:hover {
    background: var(--surface);
    border-color: var(--ink-4);
    color: var(--ink-2);
  }

  .tag-input {
    flex: 0 0 auto;
    width: 120px;
    padding: 5px 10px;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 11.5px;
    font-weight: 500;
    letter-spacing: -0.005em;
    outline: none;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .tag-input::placeholder { color: var(--ink-4); }

  /* ══════════════ DOC EDITOR ══════════════ */
  .editor-shell {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .editor {
    flex: 1;
    width: 100%;
    padding: 40px 28px 80px;
    border: none;
    outline: none;
    resize: none;
    background: transparent;
    color: var(--ink);
    font-family: var(--font-serif);
    font-size: 19px;
    line-height: 1.7;
    letter-spacing: -0.005em;
    caret-color: var(--ink);
    transition: color .25s var(--ease);
  }
  .editor::placeholder {
    color: var(--ink-4);
    font-style: italic;
  }

  /* ══════════════ PREVIEW ══════════════ */
  .preview-shell {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 40px 28px 80px;
  }

  .markdown {
    font-family: var(--font-serif);
    font-size: 19px;
    line-height: 1.7;
    letter-spacing: -0.005em;
    color: var(--ink);
    word-wrap: break-word;
  }

  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4),
  .markdown :global(h5),
  .markdown :global(h6) {
    font-family: var(--font-serif);
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.25;
    margin: 1.6em 0 0.6em;
    color: var(--ink);
  }
  .markdown :global(h1:first-child),
  .markdown :global(h2:first-child),
  .markdown :global(h3:first-child) {
    margin-top: 0;
  }
  .markdown :global(h1) { font-size: 30px; letter-spacing: -0.03em; }
  .markdown :global(h2) { font-size: 24px; letter-spacing: -0.025em; }
  .markdown :global(h3) { font-size: 20px; }
  .markdown :global(h4) { font-size: 17px; font-weight: 700; }
  .markdown :global(h5),
  .markdown :global(h6) {
    font-size: 14px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-2);
  }

  .markdown :global(p) {
    margin: 0 0 1em;
  }
  .markdown :global(p:last-child) {
    margin-bottom: 0;
  }

  .markdown :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
    transition: opacity .15s var(--ease);
  }
  .markdown :global(a:hover) { opacity: .75; }

  .markdown :global(strong) { font-weight: 700; }
  .markdown :global(em) { font-style: italic; }
  .markdown :global(del) { color: var(--ink-3); }

  .markdown :global(code) {
    font-family: var(--font-mono);
    font-size: 0.88em;
    background: var(--paper-2);
    padding: 2px 6px;
    border-radius: 5px;
    color: var(--danger);
    letter-spacing: 0;
  }

  .markdown :global(pre) {
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--hairline);
    padding: 16px 18px;
    border-radius: 12px;
    overflow-x: auto;
    margin: 1.2em 0;
    font-size: 0.85em;
    line-height: 1.55;
  }
  .markdown :global(pre code) {
    background: transparent;
    color: inherit;
    padding: 0;
    font-size: inherit;
    border-radius: 0;
  }

  .markdown :global(blockquote) {
    margin: 1.2em 0;
    padding: 4px 0 4px 18px;
    border-left: 3px solid var(--hairline-2);
    color: var(--ink-2);
    font-style: italic;
  }

  .markdown :global(ul),
  .markdown :global(ol) {
    margin: 0.8em 0 1em;
    padding-left: 24px;
  }
  .markdown :global(li) {
    margin-bottom: 0.35em;
  }
  .markdown :global(li > p) {
    margin: 0;
  }

  .markdown :global(li > input[type="checkbox"]) {
    margin-right: 8px;
    vertical-align: middle;
    accent-color: var(--accent);
  }
  .markdown :global(li:has(> input[type="checkbox"])) {
    list-style: none;
    margin-left: -20px;
  }

  .markdown :global(hr) {
    border: none;
    border-top: 1px solid var(--hairline-2);
    margin: 2em 0;
  }

  .markdown :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1.2em 0;
    font-size: 0.92em;
  }
  .markdown :global(th),
  .markdown :global(td) {
    padding: 8px 12px;
    border-bottom: 1px solid var(--hairline);
    text-align: left;
  }
  .markdown :global(th) {
    font-weight: 700;
    border-bottom-width: 2px;
    border-bottom-color: var(--hairline-2);
  }

  .markdown :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 10px;
    margin: 1em 0;
  }

  /* ══════════════ FOOTER ══════════════ */
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 20px calc(12px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--hairline);
    flex-shrink: 0;
  }

  .stats {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 500;
    color: var(--ink-3);
    letter-spacing: 0.01em;
  }
  .stats .sep { color: var(--ink-4); font-size: 10px; }

  .mode-hint {
    font-size: 10.5px;
    font-weight: 500;
    color: var(--ink-4);
    letter-spacing: 0.01em;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .mode-hint kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 1px 5px;
    background: var(--paper-2);
    border-radius: 4px;
    color: var(--ink-2);
    border: 1px solid var(--hairline);
  }

  /* ══════════════ LIST EDITOR ══════════════ */
  .list-editor {
    flex: 1;
    padding: 28px 24px 40px;
    overflow-y: auto;
  }

  .list-title {
    width: 100%;
    border: none;
    outline: none;
    background: transparent;
    font-family: var(--font-serif);
    font-size: 26px;
    font-weight: 500;
    letter-spacing: -0.03em;
    color: var(--ink);
    padding: 0;
    margin-bottom: 6px;
  }
  .list-title::placeholder {
    color: var(--ink-4);
    font-style: italic;
  }

  .list-meta {
    font-size: 11.5px;
    font-weight: 500;
    color: var(--ink-3);
    letter-spacing: -0.005em;
    margin-bottom: 22px;
  }

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
    padding: 6px 0;
    min-height: 40px;
  }

  .checkbox {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1.5px solid var(--ink-4);
    border-radius: 7px;
    background: transparent;
    color: #fff;
    cursor: pointer;
    transition: background .18s var(--ease),
                border-color .18s var(--ease);
    padding: 0;
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
    font-weight: 400;
    letter-spacing: -0.005em;
    color: var(--ink);
    padding: 4px 0;
    transition: color .2s var(--ease);
  }
  .item-input::placeholder { color: var(--ink-4); }

  .item.done .item-input {
    color: var(--ink-3);
    text-decoration: line-through;
    text-decoration-color: var(--ink-4);
    text-decoration-thickness: 1px;
  }

  .remove {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity .15s var(--ease), background .15s var(--ease), color .15s var(--ease);
  }
  .item:hover .remove,
  .remove:focus-visible { opacity: 1; }
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
    letter-spacing: -0.005em;
    cursor: pointer;
    transition: background .18s var(--ease), border-color .18s var(--ease), color .18s var(--ease);
  }
  .add-item:hover {
    background: var(--paper-2);
    border-color: var(--ink-4);
    color: var(--ink);
  }
  .add-item:active { transform: scale(.98); }

  /* ══════════════ RESPONSIVE ══════════════ */
  @media (min-width: 720px) {
    .editor,
    .preview-shell {
      padding: 56px 48px 100px;
      font-size: 20px;
      line-height: 1.72;
    }
    .markdown { font-size: 20px; line-height: 1.72; }
    .markdown :global(h1) { font-size: 34px; }
    .markdown :global(h2) { font-size: 26px; }
    .markdown :global(h3) { font-size: 21px; }

    .head { padding: 16px 24px; }
    .foot { padding: 14px 28px calc(14px + env(safe-area-inset-bottom)); }
    .tags-bar { padding: 10px 24px; }
    .list-editor { padding: 40px 48px 60px; }
    .list-title { font-size: 30px; }
  }

  @media (max-width: 400px) {
    .editor,
    .preview-shell { padding: 32px 20px 60px; font-size: 18px; }
    .markdown { font-size: 18px; }
    .markdown :global(h1) { font-size: 26px; }
    .markdown :global(h2) { font-size: 22px; }

    .head { padding: 12px 14px; }
    .tags-bar { padding: 8px 14px; }
    .list-editor { padding: 22px 18px 32px; }
    .list-title { font-size: 22px; }
    .status-slot { min-width: 40px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .editor-screen, .checkbox, .add-item, .remove,
    .editor-tag, .add-tag, .preview-btn {
      transition: none;
      animation: none;
    }
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
</style>