<script>
  import { createEventDispatcher, onMount, tick } from 'svelte';

  const dispatch = createEventDispatcher();

  export let deleteLabel = 'Delete';
  export let restoreLabel = 'Restore';
  export let variant = 'delete'; // 'delete' | 'restore'

  let el;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let dragging = false;
  let locked = false;
  let revealAmount = 0;
  let revealed = false;

  // Distinguishes a real tap from the tail of a swipe.
  // Set to true on touchmove; reset on touchstart.
  let wasSwipe = false;

  const REVEAL_WIDTH = 96;
  const LOCK_THRESHOLD = 10;

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    currentX = revealed ? -REVEAL_WIDTH : 0;
    dragging = true;
    locked = false;
    wasSwipe = false;
  }

  function onTouchMove(e) {
    if (!dragging) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (!locked) {
      if (Math.abs(dx) < LOCK_THRESHOLD && Math.abs(dy) < LOCK_THRESHOLD) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        // Vertical scroll — abandon the swipe
        dragging = false;
        return;
      }
      locked = true;
      wasSwipe = true;
    }

    if (e.cancelable) e.preventDefault();

    const base = revealed ? -REVEAL_WIDTH : 0;
    let next = base + dx;
    next = Math.max(-REVEAL_WIDTH * 1.4, Math.min(0, next));
    currentX = next;
    revealAmount = Math.min(1, Math.abs(next) / REVEAL_WIDTH);
  }

  function onTouchEnd(e) {
    if (!dragging) { reset(); return; }
    dragging = false;

    if (currentX < -REVEAL_WIDTH / 2) {
      revealed = true;
      currentX = -REVEAL_WIDTH;
      revealAmount = 1;
    } else {
      revealed = false;
      currentX = 0;
      revealAmount = 0;
    }
    locked = false;

    // Suppress the "click" the browser will fire immediately after touchend.
    // It resets on the next touchstart anyway.
    if (wasSwipe) {
      e.preventDefault?.();
    }
  }

  function reset() {
    dragging = false;
    currentX = 0;
    revealed = false;
    revealAmount = 0;
    locked = false;
    wasSwipe = false;
  }

  function close() {
    reset();
  }

  function doAction(e) {
    // Stop the tap from bubbling up to the note row underneath.
    e?.stopPropagation?.();
    e?.preventDefault?.();

    if (variant === 'restore') dispatch('restore');
    else dispatch('delete');
    reset();
  }

  /**
   * Called by the note content when it is clicked.
   * - If the row was just swiped, do nothing (browser synthesized click).
   * - If the row is revealed, close it instead of letting the parent handle it.
   * - Otherwise, pass through (dispatch a 'tap' so the parent can open the note).
   */
  function onContentClick(e) {
    if (wasSwipe) {
      // swallow the synthesized click
      e.stopPropagation();
      e.preventDefault();
      wasSwipe = false;
      return;
    }
    if (revealed) {
      // tap on a revealed row closes it; don't open the note
      e.stopPropagation();
      e.preventDefault();
      reset();
      return;
    }
    // Otherwise let it bubble — the parent decides what to do
    dispatch('tap', e);
  }

  // Close on outside tap
  onMount(() => {
    const onDocClick = (e) => {
      if (revealed && el && !el.contains(e.target)) reset();
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  });

  $: translateStyle = `transform: translateX(${currentX}px)`;
  $: actionStyle = `width: ${REVEAL_WIDTH}px; opacity: ${revealAmount};`;

  export function closeRow() { reset(); }
</script>

<div
  class="swipe-row"
  bind:this={el}
  on:touchstart={onTouchStart}
  on:touchmove={onTouchMove}
  on:touchend={onTouchEnd}
  on:touchcancel={onTouchEnd}
>
  <div
    class="row-content"
    style={translateStyle}
    role="presentation"
    on:click={onContentClick}
  >
    <slot />
  </div>
  <button
    type="button"
    class="row-action {variant}"
    style={actionStyle}
    tabindex={revealed ? 0 : -1}
    aria-hidden={!revealed}
    on:click={doAction}
  >
    {#if variant === 'restore'}
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12 A9 9 0 1 0 12 3 A9 9 0 0 0 6 5"/>
        <path d="M3 3 V9 H9"/>
      </svg>
      <span>{restoreLabel}</span>
    {:else}
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6 H21 M8 6 V4 A2 2 0 0 1 10 2 H14 A2 2 0 0 1 16 4 V6 M6 6 L7 20 A2 2 0 0 0 9 22 H15 A2 2 0 0 0 17 20 L18 6 M10 11 V17 M14 11 V17"/>
      </svg>
      <span>{deleteLabel}</span>
    {/if}
  </button>
</div>

<style>
  .swipe-row {
    position: relative;
    border-radius: 16px;
    overflow: hidden;
    background: transparent;
    isolation: isolate;
  }

  .row-content {
    position: relative;
    z-index: 1;
    transition: transform .22s var(--ease);
    will-change: transform;
    touch-action: pan-y;
  }

  .row-action {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 96px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: none;
    font: inherit;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: #fff;
    cursor: pointer;
    padding: 0;
    transition: opacity .18s var(--ease);
    z-index: 0;
  }

  .row-action.delete  { background: var(--danger); }
  .row-action.restore { background: var(--accent); }

  .row-action span {
    line-height: 1;
  }
</style>