// Markdown writers, one per kind of data. Each takes the parsed category from the
// export and an OutputDir, and returns rows for the summary printed at the end.
// Exports differ between Raycast versions, so every field is treated as optional.
// Raycast 1.x keeps the same kinds of data under other keys and field names; where
// the shape is close enough the same writer handles both.

import { richTextToMarkdown } from './richtext.js';
import {
  safeName, safeFileName, uniqueNamer, fence, timestamp, details, escapeHtml, tableCell, linkTarget, compareDates,
} from './markdown.js';

const list = value => (Array.isArray(value) ? value : []);
const join = parts => parts.join('\n\n') + '\n';

// ---------------------------------------------------------------- notes

/** Raycast 1.x stores a note's rich text as base64-encoded JSON. */
function decodeDocument(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    return undefined; // the plain text of the note is used instead
  }
}

function writeNotes(data, out, { classic = false } = {}) {
  const notes = list(data.notes);
  const images = list(data.images);

  // Images are stored once and referenced from the notes by attachment id.
  const imagePaths = new Map();
  const imageName = uniqueNamer();
  for (const image of images) {
    if (typeof image?.content !== 'string') continue;
    const [, base, ext = ''] = /^(.*?)(\.[^.]*)?$/s.exec(safeFileName(image.filename ?? String(image.id)));
    const path = `images/${imageName(base, ext)}`;
    out.write(`notes/${path}`, Buffer.from(image.content, 'base64'));
    imagePaths.set(String(image.id).toLowerCase(), path);
  }

  const noteName = uniqueNamer();
  for (const note of notes) {
    const text = typeof note.text === 'string' ? note.text : '';
    const doc = classic ? decodeDocument(note.document) : note.rawContent;
    const body = doc?.content ? richTextToMarkdown(doc, { resolveImage: id => imagePaths.get(id) }) : text;
    const frontMatter = [
      '---',
      `id: ${note.id}`,
      `created: ${note.createdAt ?? ''}`,
      `updated: ${note.updatedAt ?? note.lastModifiedAt ?? note.modifiedAt ?? ''}`,
      ...(classic ? [] : [`pinned: ${Boolean(note.pinned)}`]), // 1.x exports do not say
      '---',
    ].join('\n');
    const title = note.title?.trim() || text.trim().split('\n')[0];
    out.write(`notes/${noteName(safeName(title), '.md')}`, `${frontMatter}\n${body}\n`);
  }

  const rows = notes.length ? [{ count: notes.length, label: 'notes', path: 'notes/' }] : [];
  if (imagePaths.size) rows.push({ count: imagePaths.size, label: 'note images', path: 'notes/images/' });
  return rows;
}

/** Raycast 1.x: the single note of the older Floating Notes feature. */
function writeFloatingNote(data, out) {
  if (typeof data.note !== 'string' || !data.note.trim()) return [];
  out.write('floating-notes.md', data.note.endsWith('\n') ? data.note : `${data.note}\n`);
  return [{ count: 1, label: 'floating note', path: 'floating-notes.md' }];
}

// ---------------------------------------------------------------- AI chats

function renderToolResult(result) {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    return result.map(part => (part?.type === 'text' && typeof part.text === 'string' ? part.text : JSON.stringify(part, null, 2))).join('\n');
  }
  return JSON.stringify(result, null, 2);
}

function attachmentLine(a) {
  let label = String((typeof a === 'string' ? a : a?.filename ?? a?.name ?? a?.path ?? a?.id) ?? 'file');
  try { label = decodeURIComponent(label); } catch { /* keep the raw name */ }
  return `_Attachment: ${label} (${a?.contentType ?? a?.type ?? 'unknown type'})_`;
}

function renderMessage(message) {
  const c = typeof message.content === 'string' ? { type: 'text', text: message.content } : (message.content ?? {});
  switch (c.type) {
    case 'user-query': {
      let s = c.text ?? '';
      for (const a of list(c.attachments)) s += `\n\n${attachmentLine(a)}`;
      return s;
    }
    case 'text': {
      let s = c.text ?? '';
      const references = list(c.references).filter(r => r?.url);
      if (references.length) {
        s += '\n\n**References**\n\n' + references.map(r => `- [${tableCell(r.title || r.url).replace(/[\[\]]/g, '')}](${linkTarget(r.url)})`).join('\n');
      }
      return s;
    }
    case 'reasoning':
      return details('Reasoning', c.reasoning ?? c.text ?? '');
    case 'tool': {
      const result = renderToolResult(c.result);
      const body = `**Arguments**\n\n${fence(JSON.stringify(c.arguments ?? {}, null, 2), 'json')}` + (result ? `\n\n**Result**\n\n${fence(result)}` : '');
      return details(`Tool call: <code>${escapeHtml(c.name ?? 'unknown')}</code> (${escapeHtml(c.runStatus ?? 'unknown status')})`, body);
    }
    case 'command': {
      const input = c.inputText ?? c.input ?? '';
      return `**AI Command: ${c.name ?? c.id ?? 'unknown'}**`
        + (input ? `\n\n${fence(input)}` : '')
        + (c.error ? `\n\n_Error: ${c.error}_` : '')
        + (c.promptTemplate ? `\n\n${details('Prompt template', fence(c.promptTemplate))}` : '');
    }
    case 'model_switch': {
      const name = model => model?.name ?? model?.id ?? (typeof model === 'string' ? model : 'unknown');
      return `_Model switched from ${name(c.previousModel)} to ${name(c.model)}_`;
    }
    default:
      // A content type this tool does not know yet: show it as-is rather than drop it.
      return typeof c.text === 'string' ? c.text : fence(JSON.stringify(c, null, 2), 'json');
  }
}

function writeChats(ai, out) {
  const folders = new Map(list(ai.folders).map(f => [f.id, f.name]));
  const messagesByChat = new Map();
  for (const message of list(ai.messages)) {
    if (!messagesByChat.has(message.chatId)) messagesByChat.set(message.chatId, []);
    messagesByChat.get(message.chatId).push(message);
  }
  const chats = new Map(list(ai.chats).map(c => [c.id, c]));
  // Messages whose chat record is missing are still worth keeping.
  for (const id of messagesByChat.keys()) if (!chats.has(id)) chats.set(id, { id, source: 'orphaned' });

  const namers = new Map();
  let written = 0;
  for (const chat of chats.values()) {
    const messages = (messagesByChat.get(chat.id) ?? []).sort((a, b) => compareDates(a.createdAt, b.createdAt));
    if (!messages.length) continue;

    const firstQuery = messages.find(m => m.content?.type === 'user-query')?.content.text ?? '';
    const title = chat.title?.trim() || String(firstQuery).trim().split('\n')[0].slice(0, 80) || 'Untitled';
    const meta = [
      ['Chat ID', chat.id], ['Source', chat.source], ['Model', chat.modelId], ['Folder', folders.get(chat.folderId)],
      ['Created', timestamp(chat.createdAt)], ['Updated', timestamp(chat.updatedAt)], ['Pinned', chat.pinned ? 'yes' : ''],
    ].filter(([, value]) => value).map(([key, value]) => `- **${key}:** ${value}`);
    const parts = [`# ${title}`, meta.join('\n')];
    if (chat.systemInstructions) parts.push(details('System instructions', fence(chat.systemInstructions)));

    let speaker;
    for (const message of messages) {
      const who = message.role === 'user' ? 'User' : message.role === 'command' ? 'Command' : 'Assistant';
      if (who !== speaker) {
        const model = who === 'Assistant' && message.modelId ? ` · ${message.modelId}` : '';
        parts.push(`## ${who}${model} · ${timestamp(message.createdAt)}`);
        speaker = who;
      }
      const status = message.status && message.status !== 'completed' ? `\n\n_(${message.status})_` : '';
      parts.push(renderMessage(message) + status);
    }

    const dir = `ai-chats/${safeName(chat.source ?? 'unknown')}`;
    if (!namers.has(dir)) namers.set(dir, uniqueNamer());
    const date = /^\d{4}-\d\d-\d\d/.exec(String(chat.createdAt ?? messages[0].createdAt ?? ''))?.[0];
    out.write(`${dir}/${namers.get(dir)(safeName(`${date ?? ''} ${title}`), '.md')}`, join(parts));
    written++;
  }
  return written ? [{ count: written, label: 'AI chats', path: 'ai-chats/' }] : [];
}

// Raycast 1.x writes chat dates as "2024-10-19 04:25:37.397", in UTC without saying so.
const classicDate = value => String(value ?? '').replace(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d(\.\d+)?)$/, '$1T$2Z');

/** Raycast 1.x: each chat carries its own messages, and a message is plain text. */
function writeClassicChats(ai, out) {
  const name = uniqueNamer();
  let written = 0;
  for (const chat of list(ai.aiChats)) {
    const record = chat?.record ?? {};
    const messages = list(chat?.messages).filter(m => m && typeof m === 'object')
      .sort((a, b) => compareDates(classicDate(a.timestamp), classicDate(b.timestamp)));
    if (!messages.length) continue;

    const firstQuery = messages.find(m => m.source === 'user')?.text ?? '';
    const title = record.title?.trim() || String(firstQuery).trim().split('\n')[0].slice(0, 80) || 'Untitled';
    const meta = [
      ['Chat ID', record.id], ['Model', record.model],
      ['Created', timestamp(classicDate(record.createdAt))], ['Updated', timestamp(classicDate(record.modifiedAt))],
    ].filter(([, value]) => value).map(([key, value]) => `- **${key}:** ${value}`);
    const parts = [`# ${title}`];
    if (meta.length) parts.push(meta.join('\n'));

    let speaker;
    for (const message of messages) {
      const who = message.source === 'user' ? 'User' : 'Assistant';
      if (who !== speaker) {
        const model = who === 'Assistant' && message.modelUsed ? ` · ${message.modelUsed}` : '';
        parts.push(`## ${who}${model} · ${timestamp(classicDate(message.timestamp))}`);
        speaker = who;
      }
      const attachments = list(message.attachments).map(a => `\n\n${attachmentLine(a)}`).join('');
      parts.push(String(message.text ?? '') + attachments + (message.isCancelled ? '\n\n_(canceled)_' : ''));
    }

    const date = /^\d{4}-\d\d-\d\d/.exec(String(record.createdAt ?? messages[0].timestamp ?? ''))?.[0];
    out.write(`ai-chats/${name(safeName(`${date ?? ''} ${title}`), '.md')}`, join(parts));
    written++;
  }
  return written ? [{ count: written, label: 'AI chats', path: 'ai-chats/' }] : [];
}

function writeTranscriptions(ai, out) {
  const items = list(ai.transcriptions);
  if (!items.length) return [];
  const parts = ['# Dictation transcriptions'];
  for (const t of [...items].sort((a, b) => compareDates(b.startedAt ?? b.createdAt, a.startedAt ?? a.createdAt))) {
    const heading = [
      timestamp(t.startedAt ?? t.createdAt), t.applicationName, t.duration != null ? `${t.duration}s` : '',
      t.wordCount != null ? `${t.wordCount} words` : '', t.status && t.status !== 'success' ? t.status : '',
    ];
    parts.push(`### ${heading.filter(Boolean).join(' · ')}`, t.value ?? '');
    if (t.rawValue && t.rawValue !== t.value) parts.push(details('Raw transcription', escapeHtml(t.rawValue)));
  }
  out.write('transcriptions.md', join(parts));
  return [{ count: items.length, label: 'dictation transcriptions', path: 'transcriptions.md' }];
}

// ---------------------------------------------------------------- snippets, quicklinks

function writeSnippets(data, out) {
  const snippets = list(data.snippets);
  if (!snippets.length) return [];
  const parts = ['# Snippets'];
  for (const s of snippets) {
    const keyword = s.keyword ?? s.alias; // 1.x calls it an alias
    const updated = s.updatedAt ?? s.modifiedAt;
    const meta = [`Used ${s.copyCount ?? 0}×`, s.createdAt ? `created ${timestamp(s.createdAt)}` : '', updated ? `updated ${timestamp(updated)}` : '', list(s.tags).join(', ')];
    parts.push(
      `## ${s.title ?? s.name ?? 'Untitled'}${keyword ? ` — \`${keyword}\`` : ''}`,
      fence(typeof s.text === 'string' ? s.text : richTextToMarkdown(s.rawContent)),
      `_${meta.filter(Boolean).join(' · ')}_`,
    );
  }
  out.write('snippets.md', join(parts));
  return [{ count: snippets.length, label: 'snippets', path: 'snippets.md' }];
}

function writeQuicklinks(data, out) {
  const quicklinks = list(data.quicklinks);
  if (!quicklinks.length) return [];
  // 1.x records when a quicklink was last changed rather than when it was created.
  const [dateLabel, dateKey] = quicklinks.some(q => q?.createdAt) || !quicklinks.some(q => q?.updatedAt) ? ['Created', 'createdAt'] : ['Updated', 'updatedAt'];
  const rows = quicklinks.map(q =>
    `| ${tableCell(q.name)}${q.isEnabled === false ? ' (disabled)' : ''} | \`${tableCell(q.link ?? q.url)}\` | ${tableCell(q.openWith ?? q.applicationId ?? q.applicationID)} | ${q.openCount ?? 0} | ${timestamp(q[dateKey])} |`);
  out.write('quicklinks.md', ['# Quicklinks', '', `| Name | Link | Opens with | Opened | ${dateLabel} |`, '|---|---|---|---|---|', ...rows].join('\n') + '\n');
  return [{ count: quicklinks.length, label: 'quicklinks', path: 'quicklinks.md' }];
}

// ---------------------------------------------------------------- clipboard history

// Binary clipboard flavours worth saving as files, and the extension to give them.
const BLOB_EXTENSIONS = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/tiff': 'tiff', 'image/heic': 'heic', 'image/webp': 'webp',
  'application/pdf': 'pdf', 'text/rtf': 'rtf', 'application/x-webarchive': 'webarchive',
};
const ALWAYS_SAVE = /^image\/|^application\/pdf$/;

function writeClipboard(data, out) {
  const entries = list(data.clipboardEntries);
  if (!entries.length) return [];
  const parts = [
    '# Clipboard history',
    '_Newest first. Entries marked "stored on disk" point at files Raycast keeps in its own data folder on the computer that made the export; those files are referenced by the export, not included in it._',
  ];
  let files = 0;
  const fileName = uniqueNamer();
  const sorted = [...entries].sort((a, b) => compareDates(b.createdAt, a.createdAt));
  sorted.forEach((entry, n) => {
    const heading = [
      timestamp(entry.createdAt), entry.source?.name, list(entry.categories).join(', '),
      entry.copyCount > 1 ? `copied ${entry.copyCount}×` : '', entry.pinned ? 'pinned' : '', list(entry.tags).join(', '),
    ];
    parts.push(`### ${heading.filter(Boolean).join(' · ')}`);

    let rendered = false;
    for (const item of list(entry.items)) {
      const reps = list(item?.representations).filter(r => typeof r?.content === 'string' && typeof r.mimeType === 'string');
      const text = reps.find(r => r.contentType === 'text' && r.mimeType.startsWith('text/plain'))
        ?? reps.find(r => r.contentType === 'text' && r.mimeType === 'text/uri-list');
      if (text) { parts.push(fence(text.content)); rendered = true; }

      for (const r of reps) {
        if (r.contentType === 'url') {
          parts.push(`Stored on disk (${r.mimeType}): \`${r.content}\``);
          rendered = true;
        }
        // Images and PDFs are always saved; rich-text flavours only when there is no plain text to show.
        const ext = BLOB_EXTENSIONS[r.mimeType];
        if (r.contentType === 'blob' && ext && (!text || ALWAYS_SAVE.test(r.mimeType))) {
          const base = `${String(n + 1).padStart(5, '0')}-${safeName(entry.contentHash ?? 'item', 40)}`;
          const path = `clipboard-files/${fileName(base, `.${ext}`)}`;
          out.write(path, Buffer.from(r.content, 'base64'));
          parts.push(`Saved: [${path}](${linkTarget(path)})`);
          files++;
          rendered = true;
        }
      }

      const ocr = reps.find(r => r.mimeType === 'application/vnd.raycast.ocr');
      if (ocr && !text) { parts.push(`Text recognised in image:\n\n${fence(ocr.content)}`); rendered = true; }
    }
    if (!rendered) parts.push(entry.title ? fence(entry.title) : '_(no readable representation; see json/clipboardHistory.json)_');
  });
  out.write('clipboard.md', join(parts));

  const rows = [{ count: entries.length, label: 'clipboard entries', path: 'clipboard.md' }];
  if (files) rows.push({ count: files, label: 'clipboard images and files', path: 'clipboard-files/' });
  return rows;
}

// ----------------------------------------------------------------

/**
 * The Markdown sections, in output order. `category` is the top-level key of the
 * export that the section reads; a name can appear more than once.
 */
export const SECTIONS = [
  { name: 'notes', category: 'notes', write: writeNotes },
  { name: 'chats', category: 'ai', write: writeChats },
  { name: 'transcriptions', category: 'ai', write: writeTranscriptions },
  { name: 'snippets', category: 'snippets', write: writeSnippets },
  { name: 'quicklinks', category: 'quicklinks', write: writeQuicklinks },
  { name: 'clipboard', category: 'clipboardHistory', write: writeClipboard },
  // Raycast 1.x. Its exports hold no clipboard or dictation history.
  { name: 'notes', category: 'builtin_package_raycastNotes', write: (data, out) => writeNotes(data, out, { classic: true }) },
  { name: 'notes', category: 'builtin_package_floatingNotes', write: writeFloatingNote },
  { name: 'chats', category: 'builtin_package_open-ai', write: writeClassicChats },
  { name: 'snippets', category: 'builtin_package_snippets', write: writeSnippets },
  { name: 'quicklinks', category: 'builtin_package_quicklinks', write: writeQuicklinks },
];
