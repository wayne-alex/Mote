// src/lib/prefs.js
import { writable } from 'svelte/store';

const KEY = 'mote:prefs';

const DEFAULTS = {
  theme: 'system',       // 'system' | 'light' | 'dark'
  fontSize: 'medium',    // 'small' | 'medium' | 'large'
  defaultSort: 'updated' // 'updated' | 'created' | 'title'
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
}

export const prefs = writable(load());

prefs.subscribe((value) => {
  save(value);
  applyTheme(value.theme);
  applyFontSize(value.fontSize);
});

export function setPref(key, value) {
  prefs.update((p) => ({ ...p, [key]: value }));
}

function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (theme === 'system') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

function applyFontSize(size) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-font-size', size);
}

/**
 * React to system theme changes when theme === 'system'.
 * Call once from App.svelte.
 */
export function watchSystemTheme() {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    prefs.update((p) => {
      if (p.theme === 'system') applyTheme('system');
      return p;
    });
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}