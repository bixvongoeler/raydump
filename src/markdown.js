// Small helpers shared by the Markdown writers.

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Cuts a string to at most `maxBytes` of UTF-8 without splitting a character. */
function truncateUtf8(s, maxBytes) {
  let bytes = 0, out = '';
  for (const ch of s) {
    bytes += Buffer.byteLength(ch);
    if (bytes > maxBytes) break;
    out += ch;
  }
  return out;
}

/**
 * Turns arbitrary text (a note title, a chat's first question) into a file name
 * that is valid on macOS, Linux and Windows.
 */
export function safeName(text, maxBytes = 150) {
  let name = String(text ?? '').replace(/[\/\\:*?"<>|\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  name = truncateUtf8(name, maxBytes).replace(/^\.+/, '').replace(/[. ]+$/, '').trim();
  if (!name) return 'Untitled';
  return RESERVED_WINDOWS_NAMES.test(name) ? `_${name}` : name;
}

/** Like safeName, but keeps the file extension intact. */
export function safeFileName(filename, maxBytes = 150) {
  const match = /^(.*?)(\.[A-Za-z0-9]{1,10})?$/s.exec(String(filename ?? ''));
  const ext = match[2] ?? '';
  return safeName(match[1], maxBytes - ext.length) + ext;
}

/**
 * Returns a function that makes names unique within one directory by appending
 * " (2)", " (3)", ... Comparison ignores case and Unicode normalisation, because
 * the default macOS and Windows file systems do.
 */
export function uniqueNamer() {
  const seen = new Map();
  return (name, ext = '') => {
    const key = (name + ext).normalize('NFC').toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return (n === 1 ? name : `${name} (${n})`) + ext;
  };
}

/** A code fence long enough that the content cannot close it early. */
export function fence(text, lang = '') {
  const s = String(text ?? '');
  let longest = 0;
  for (const m of s.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const marks = '`'.repeat(Math.max(3, longest + 1));
  return `${marks}${lang}\n${s}\n${marks}`;
}

/** "2026-11-12T20:40:08.227Z" -> "2026-11-12 20:40:08 UTC"; anything else is passed through. */
export function timestamp(value) {
  if (value === undefined || value === null || value === '') return '';
  return String(value).replace(/^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(\.\d+)?Z$/, '$1 $2 UTC');
}

/** Parses an export date (an ISO string, or milliseconds since 1970) into a Date; undefined when it is not one. */
export function toDate(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(typeof value === 'number' ? value : String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Inline code that stays intact whatever backticks the text contains. */
export function codeSpan(text) {
  const s = String(text ?? '').replace(/\s*\n\s*/g, ' ');
  let longest = 0;
  for (const m of s.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const marks = '`'.repeat(longest + 1);
  const pad = /^`|`$/.test(s) ? ' ' : '';
  return `${marks}${pad}${s}${pad}${marks}`;
}

export const escapeHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A collapsible block. `summary` must already be HTML-safe. */
export const details = (summary, body) => `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`;

/** Makes text safe inside a Markdown table cell. */
export const tableCell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** A Markdown link destination; paths with spaces or parentheses need angle brackets. */
export const linkTarget = path => (/[\s()]/.test(path) ? `<${path}>` : path);

/** Orders ISO date strings chronologically; unparseable values keep their relative order. */
export function compareDates(a, b) {
  const diff = Date.parse(a) - Date.parse(b);
  return Number.isNaN(diff) ? 0 : diff;
}
