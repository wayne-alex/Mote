import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',

      includeAssets: [
        'favicon.svg',
        'favicon-32x32.png',
        'favicon-16x16.png',
        'apple-touch-icon.png',
      ],

      manifest: {
        name: 'Mote — Notes',
        short_name: 'Mote',
        description: 'A quiet place for thoughts. Everything stays on your device.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#fafaf8',
        background_color: '#fafaf8',
        categories: ['productivity', 'utilities'],
        lang: 'en',
        dir: 'ltr',

        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],

        share_target: {
          action: '/share',
          method: 'GET',
          enctype: 'application/x-www-form-urlencoded',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
          },
        },

        shortcuts: [
          {
            name: 'New note',
            short_name: 'Note',
            description: 'Start a blank note',
            url: '/?action=new-doc',
            icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'New to-do',
            short_name: 'To-do',
            description: 'Start a to-do list',
            url: '/?action=new-todo',
            icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
          },
        ],
      },

      workbox: {
        // Cache the built app shell — HTML, JS, CSS, fonts, icons
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],

        // Don't precache huge chunks — cap at 2MB per file
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,

        // Serve index.html for any navigation request while offline
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],

        // Runtime caching for external resources
        runtimeCaching: [
          {
            // Google Fonts CSS — cache aggressively
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-css',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts files — cache forever
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },

      devOptions: {
        // Enable the PWA in dev so we can test install + manifest
        enabled: true,
        type: 'module',
      },
    }),
  ],

  server: {
    port: 5173,
    host: '0.0.0.0',
  },
});