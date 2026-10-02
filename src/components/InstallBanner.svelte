<script>
  import { onMount } from 'svelte';

  let deferredPrompt = null;
  let visible = false;
  let dismissing = false;

  const DISMISSED_KEY = 'mote:installDismissed';

  onMount(() => {
    // Don't show if the user already dismissed it in this browser session
    if (localStorage.getItem(DISMISSED_KEY) === '1') return;

    // Don't show if we're already running as an installed PWA
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    if (standalone) return;

    const handler = (e) => {
      e.preventDefault();
      deferredPrompt = e;
      visible = true;
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  });

  async function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (choice.outcome === 'accepted') {
      visible = false;
    }
  }

  function dismiss() {
    dismissing = true;
    localStorage.setItem(DISMISSED_KEY, '1');
    setTimeout(() => (visible = false), 200);
  }
</script>

{#if visible}
  <div class="banner" class:dismissing>
    <div class="banner-icon">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3 V16 M7 11 L12 16 L17 11 M4 20 H20"/>
      </svg>
    </div>
    <div class="banner-body">
      <div class="banner-title">Install Mote</div>
      <div class="banner-text">Open from your home screen, works offline.</div>
    </div>
    <button class="banner-install" on:click={install}>Install</button>
    <button class="banner-close" on:click={dismiss} aria-label="Dismiss">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 6 L18 18 M18 6 L6 18"/>
      </svg>
    </button>
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    left: 50%;
    bottom: calc(20px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 300;
    display: flex;
    align-items: center;
    gap: 12px;
    width: min(calc(100% - 32px), 460px);
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-3), 0 0 0 1px var(--hairline);
    animation: slideIn .35s var(--ease) both;
  }

  .banner.dismissing {
    animation: slideOut .2s var(--ease) both;
  }

  @keyframes slideIn {
    from { opacity: 0; transform: translate(-50%, 16px); }
    to   { opacity: 1; transform: translate(-50%, 0); }
  }
  @keyframes slideOut {
    to { opacity: 0; transform: translate(-50%, 12px); }
  }

  .banner-icon {
    width: 38px;
    height: 38px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 11px;
    background: var(--ink);
    color: var(--paper);
  }

  .banner-body {
    flex: 1;
    min-width: 0;
  }
  .banner-title {
    font-size: 13.5px;
    font-weight: 700;
    letter-spacing: -0.015em;
    color: var(--ink);
  }
  .banner-text {
    font-size: 11.5px;
    color: var(--ink-3);
    letter-spacing: -0.005em;
    margin-top: 1px;
  }

  .banner-install {
    padding: 8px 14px;
    border: none;
    border-radius: 10px;
    background: var(--accent);
    color: #fff;
    font: inherit;
    font-size: 12.5px;
    font-weight: 700;
    letter-spacing: -0.005em;
    cursor: pointer;
    flex-shrink: 0;
    transition: filter .15s var(--ease), transform .15s var(--ease);
  }
  .banner-install:hover { filter: brightness(1.05); }
  .banner-install:active { transform: scale(.96); }

  .banner-close {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    flex-shrink: 0;
    transition: background .15s var(--ease), color .15s var(--ease);
  }
  .banner-close:hover {
    background: var(--paper-2);
    color: var(--ink);
  }

  @media (prefers-reduced-motion: reduce) {
    .banner, .banner.dismissing {
      animation: none;
    }
  }
</style>