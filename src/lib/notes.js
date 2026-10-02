
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function deriveTitle(body) {
  if (!body) return '';
  const firstLine = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return '';
  return firstLine.slice(0, 80);
}

export function wordCount(body) {
  if (!body) return 0;
  return body.trim().split(/\s+/).filter(Boolean).length;
}

export function charCount(body) {
  return body ? body.length : 0;
}


export function patchNote(note, patch) {
  return {
    ...note,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

export function createNote({ kind = 'doc', listStyle = 'todo' } = {}) {
  const now = new Date().toISOString();
  const base = {
    id: uuid(),
    kind,
    title: '',
    tags: [],
    pinned: false,
    archived: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ownerId: null,
    sharedWith: [],
  };

  if (kind === 'list') {
    return {
      ...base,
      listStyle,
      items: [],
    };
  }

  // kind === 'doc'
  return {
    ...base,
    body: '',
  };
}

/**
 * Create a single list item.
 */
export function createListItem(text = '') {
  return {
    id: uuid(),
    text,
    done: false,
    note: '',
    doneAt: null,
  };
}

/**
 * Preview text for the list view.
 * - doc: the first ~120 chars of body, stripped of newlines
 * - list: "3 of 8 done · Milk, Eggs, Bread"
 */
export function derivePreview(note) {
  if (!note) return '';

  if (note.kind === 'list') {
    const items = note.items || [];
    if (items.length === 0) return 'Empty list';
    const done = items.filter((i) => i.done).length;
    const next = items.find((i) => !i.done) || items[0];
    const preview = items
      .slice(0, 3)
      .map((i) => i.text)
      .filter(Boolean)
      .join(' · ');
    return `${done} of ${items.length} done · ${preview}`.slice(0, 120);
  }

  const body = (note.body || '').trim();
  if (!body) return 'Empty note';
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.slice(0, 120);
}

/**
 * Title for the list view. Same as deriveTitle but handles list kind.
 */
export function deriveDisplayTitle(note) {
  if (!note) return 'Untitled';

  if (note.kind === 'list') {
    const items = note.items || [];
    const first = items.map((i) => i.text).find((t) => t && t.trim());
    if (note.title) return note.title;
    if (first) return first.slice(0, 80);
    return 'Untitled list';
  }

  if (note.title) return note.title;
  const t = deriveTitle(note.body || '');
  return t || 'Untitled';
}

/**
 * Human-readable updated-at.
 */
export function formatUpdated(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

/**
 * Normalize a tag string: lowercase, trim, collapse internal whitespace,
 * strip leading '#' and any non-alphanumeric-edge characters.
 */
export function normalizeTag(raw) {
  if (!raw) return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .slice(0, 32);
}

/**
 * Deduplicate and normalize an array of tags.
 */
export function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    const n = normalizeTag(t);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Search a single note against a lowercase query. Returns true if it matches.
 * Searches title, body, tags, and list items.
 */
export function noteMatchesQuery(note, query) {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (!q) return true;

  if (note.title && note.title.toLowerCase().includes(q)) return true;
  if (note.body && note.body.toLowerCase().includes(q)) return true;
  if (Array.isArray(note.tags) && note.tags.some((t) => t.includes(q))) return true;
  if (Array.isArray(note.items)) {
    for (const it of note.items) {
      if (it.text && it.text.toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

/**
 * Return a highlight-safe snippet around the first match.
 * Used for showing "…matched text…" in the list.
 */
export function deriveMatchSnippet(note, query) {
  if (!query) return null;
  const q = query.toLowerCase().trim();
  if (!q) return null;

  const sources = [];
  if (note.body) sources.push(note.body);
  if (Array.isArray(note.items)) sources.push(...note.items.map((i) => i.text));

  for (const src of sources) {
    if (!src) continue;
    const idx = src.toLowerCase().indexOf(q);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 24);
    const end = Math.min(src.length, idx + q.length + 24);
    const before = (start > 0 ? '…' : '') + src.slice(start, idx);
    const match = src.slice(idx, idx + q.length);
    const after = src.slice(idx + q.length, end) + (end < src.length ? '…' : '');
    return { before, match, after };
  }
  return null;
}

/**
 * Sort a list of notes. Returns a new array.
 */
export function sortNotes(notes, sort) {
  const copy = [...notes];
  switch (sort) {
    case 'created':
      return copy.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    case 'title':
      return copy.sort((a, b) => {
        const at = (a.title || '').toLowerCase() || '\uffff';
        const bt = (b.title || '').toLowerCase() || '\uffff';
        return at < bt ? -1 : at > bt ? 1 : 0;
      });
    case 'updated':
    default:
      return copy.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
}