import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import './lib/prefs.js';    // side-effect: applies theme + font size
import { registerSW } from 'virtual:pwa-register';

const app = mount(App, {
  target: document.getElementById('app'),
});

// Register the service worker (auto-update mode)
if (import.meta.env.PROD) {
  registerSW({
    immediate: true,
    onRegisteredSW(swUrl, r) {
      // Check for updates every hour while the app is open
      if (r) {
        setInterval(() => r.update(), 60 * 60 * 1000);
      }
    },
    onOfflineReady() {
      console.log('[pwa] App is ready to work offline.');
    },
    onRegisterError(err) {
      console.warn('[pwa] SW registration failed:', err);
    },
  });
} else {
  console.log('[pwa] Skipping SW in dev');
}

export default app;