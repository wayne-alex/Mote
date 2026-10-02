// src/lib/export.js
import { listAllNotes, bulkUpsertNotes } from './db.js';
import { prefs } from './prefs.js';
import { get } from 'svelte/store';

const EXPORT_VERSION = 1;
const APP_ID = 'mote';

// ═══════════════════════════════════════════════════════════
// SERIALIZE
// ═══════════════════════════════════════════════════════════

export async function buildExport() {
  const notes = await listAllNotes();
  const p = get(prefs);

  return {
    app: APP_ID,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    preferences: {
      theme: p.theme,
      fontSize: p.fontSize,
      defaultSort: p.defaultSort,
    },
    notes,
  };
}

export async function downloadExport() {
  const payload = await buildExport();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  const date = new Date().toISOString().slice(0, 10);
  const filename = `mote-backup-${date}.json`;

  triggerDownload(blob, filename);

  return {
    filename,
    count: payload.notes.length,
    bytes: blob.size,
  };
}

export function noteToMarkdown(note) {
  if (note.kind === 'list') {
    const lines = [];
    if (note.title) lines.push(`# ${note.title}`, '');
    for (const item of note.items || []) {
      lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
    }
    if (note.tags?.length) lines.push('', note.tags.map((t) => `#${t}`).join(' '));
    return lines.join('\n');
  }

  const parts = [];
  if (note.title && !note.body.startsWith(`# ${note.title}`)) {
    parts.push(`# ${note.title}`, '');
  }
  parts.push(note.body || '');
  if (note.tags?.length) parts.push('', note.tags.map((t) => `#${t}`).join(' '));
  return parts.join('\n');
}

export function downloadNote(note) {
  const md = noteToMarkdown(note);
  const blob = new Blob([md], { type: 'text/markdown' });

  const safeTitle = (note.title || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'untitled';

  const filename = `${safeTitle}.md`;
  triggerDownload(blob, filename);

  return { filename, bytes: blob.size };
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ═══════════════════════════════════════════════════════════
// PARSE + VALIDATE
// ═══════════════════════════════════════════════════════════

export async function parseImportFile(file) {
  if (!file) throw new Error('No file provided.');

  const MAX_SIZE = 20 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    throw new Error('File is too large. Mote exports are usually well under 20 MB.');
  }

  let text;
  try {
    text = await file.text();
  } catch {
    throw new Error('Could not read the file.');
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }

  if (!data || typeof data !== 'object') {
    throw new Error('File is not a Mote export.');
  }

  if (data.app !== APP_ID) {
    throw new Error('This file was not exported from Mote.');
  }

  if (!Array.isArray(data.notes)) {
    throw new Error('Export file is missing a "notes" array.');
  }

  const notes = [];
  let dropped = 0;

  for (const raw of data.notes) {
    const note = sanitizeImportedNote(raw);
    if (note) notes.push(note);
    else dropped++;
  }

  return {
    version: data.version || 0,
    exportedAt: data.exportedAt || null,
    preferences: data.preferences || null,
    notes,
    dropped,
    rawCount: data.notes.length,
  };
}

function sanitizeImportedNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.id || typeof raw.id !== 'string') return null;

  const kind = raw.kind === 'list' ? 'list' : 'doc';
  const now = new Date().toISOString();

  const base = {
    id: raw.id,
    kind,
    title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : '',
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t) => typeof t === 'string').slice(0, 50)
      : [],
    pinned: !!raw.pinned,
    archived: !!raw.archived,
    deletedAt: typeof raw.deletedAt === 'string' ? raw.deletedAt : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    ownerId: null,
    sharedWith: [],
  };

  if (kind === 'list') {
    const items = Array.isArray(raw.items) ? raw.items : [];
    base.listStyle = typeof raw.listStyle === 'string' ? raw.listStyle : 'todo';
    base.items = items
      .filter((it) => it && typeof it === 'object' && typeof it.text === 'string')
      .map((it) => ({
        id: typeof it.id === 'string' ? it.id : crypto.randomUUID(),
        text: String(it.text).slice(0, 500),
        done: !!it.done,
        note: typeof it.note === 'string' ? it.note.slice(0, 500) : '',
        doneAt: typeof it.doneAt === 'string' ? it.doneAt : null,
      }));
  } else {
    base.body = typeof raw.body === 'string' ? raw.body : '';
  }

  return base;
}

// ═══════════════════════════════════════════════════════════
// MERGE
// ═══════════════════════════════════════════════════════════

export async function mergeImport(importedNotes, strategy = 'keep-newest') {
  const { getNote } = await import('./db.js');

  const toWrite = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const incoming of importedNotes) {
    const existing = await getNote(incoming.id);

    if (!existing) {
      toWrite.push(incoming);
      created++;
      continue;
    }

    if (strategy === 'keep-mine') {
      skipped++;
      continue;
    }

    if (strategy === 'keep-imported') {
      toWrite.push(incoming);
      updated++;
      continue;
    }

    const existingTime = Date.parse(existing.updatedAt || 0);
    const incomingTime = Date.parse(incoming.updatedAt || 0);
    if (incomingTime > existingTime) {
      toWrite.push(incoming);
      updated++;
    } else {
      skipped++;
    }
  }

  if (toWrite.length > 0) {
    await bulkUpsertNotes(toWrite);
  }

  return {
    created,
    updated,
    skipped,
    total: importedNotes.length,
  };
}