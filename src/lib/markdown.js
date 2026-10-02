import { marked } from 'marked';
import DOMPurify from 'dompurify';

// ═══════════════════════════════════════════════════════════
// MARKED CONFIG
// ═══════════════════════════════════════════════════════════

marked.setOptions({
  // No GitHub-flavoured breaks — in a note-taking app, a single
  // newline should stay a newline, not become a <br>.
  breaks: true,
  gfm: true,
  headerIds: false,       // deprecated but explicit for older versions
  mangle: false,          // don't obfuscate emails — we sanitize anyway
});

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════

/**
 * Convert markdown text to safe HTML.
 *
 * @param {string} text  — raw markdown
 * @returns {string}     — sanitized HTML
 */
export function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return '';

  // Parse
  let html;
  try {
    html = marked.parse(text);
  } catch (err) {
    console.error('[markdown] parse failed:', err);
    return '';
  }

  // Sanitize — allow the tags marked can produce, no more
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'hr',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'strong', 'em', 'del', 'code', 'pre', 'blockquote',
      'ul', 'ol', 'li',
      'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'input',        // for task-list checkboxes
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'alt', 'src',
      'class', 'align',
      'type', 'checked', 'disabled',  // task-list items
      'colspan', 'rowspan',
    ],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|data:image\/)/i,
    // Force links to open in a new tab and use safe rel attributes
    ADD_ATTR: ['target', 'rel'],
  }).replace(
    /<a\s+([^>]*?)>/g,
    (match, attrs) => {
      // Only add target/rel if href is present and not already targeted
      if (!attrs.includes('target=')) {
        return `<a ${attrs} target="_blank" rel="noopener noreferrer">`;
      }
      return match;
    }
  );
}

/**
 * Whether a body has any markdown syntax that would look different
 * when rendered. Used to decide if the preview toggle should be shown.
 */
export function hasMarkdownSyntax(text) {
  if (!text) return false;
  const patterns = [
    /^#{1,6}\s/m,      // headings
    /\*\*[^*]+\*\*/,   // bold
    /(?<!\*)\*[^*]+\*(?!\*)/, // italic
    /~~[^~]+~~/,       // strikethrough
    /`[^`]+`/,         // inline code
    /```[\s\S]*?```/,  // code blocks
    /^\s*[-*+]\s/m,    // unordered lists
    /^\s*\d+\.\s/m,    // ordered lists
    /^\s*>\s/m,        // blockquotes
    /\[[^\]]+\]\([^)]+\)/, // links
    /!\[[^\]]*\]\([^)]+\)/, // images
    /\|.+\|/,          // tables
  ];
  return patterns.some((re) => re.test(text));
}