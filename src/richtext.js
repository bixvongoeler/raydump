// Converts Raycast's rich-text documents (notes, snippets) to Markdown.
//
// The documents are ProseMirror/Tiptap-style trees: { type, attrs?, content?, marks?, text? }.
// One quirk: a `list` node is a single list item (attrs.kind: bullet | ordered | task)
// that holds a paragraph followed by any nested items, so consecutive `list` siblings
// form one visual list.

import { fence, tableCell, linkTarget } from './markdown.js';

/**
 * @param {object} doc the root `doc` node
 * @param {{ resolveImage?: (attachmentId: string) => string | undefined }} [options]
 *   resolveImage maps a note image's attachment id to a path relative to the Markdown file
 * @returns {string}
 */
export function richTextToMarkdown(doc, options = {}) {
  return blocks(doc?.content, options);
}

function inline(nodes, options) {
  if (!Array.isArray(nodes)) return '';
  return nodes.map(node => {
    if (node.type === 'hardBreak') return '  \n';
    if (node.type === 'image') return image(node, options);
    if (node.type !== 'text') return node.content ? inline(node.content, options) : (node.text ?? '');

    let text = node.text ?? '';
    const marks = node.marks ?? [];
    const has = (...types) => marks.some(m => types.includes(m.type));
    // Emphasis markers must hug the text, so surrounding whitespace stays outside them.
    const wrap = (open, close = open) => {
      text = text.replace(/^(\s*)([\s\S]*?)(\s*)$/, (all, before, body, after) => (body ? `${before}${open}${body}${close}${after}` : all));
    };
    if (has('code')) {
      text = text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
    } else {
      if (has('bold')) wrap('**');
      if (has('italic')) wrap('*');
      if (has('strike', 'strikethrough')) wrap('~~');
      if (has('underline')) wrap('<u>', '</u>');
      if (has('highlight')) wrap('<mark>', '</mark>');
    }
    const href = marks.find(m => m.type === 'link')?.attrs?.href;
    return href ? `[${text}](${linkTarget(href)})` : text;
  }).join('');
}

function image(node, options) {
  const attrs = node.attrs ?? {};
  const alt = String(attrs.alt ?? attrs.title ?? '').replace(/[\[\]]/g, '');
  const id = typeof attrs.attachmentId === 'string' ? attrs.attachmentId.toLowerCase() : undefined;
  const target = (id && options.resolveImage?.(id)) ?? attrs.src ?? attrs.href ?? (id ? `attachment:${id}` : '');
  return `![${alt}](${linkTarget(String(target))})`;
}

function table(node, options) {
  const rows = (node.content ?? []).map(row =>
    (row.content ?? []).map(cell => tableCell(blocks(cell.content, options, true).replace(/\n+/g, '<br>'))));
  if (!rows.length) return '';
  const width = Math.max(...rows.map(r => r.length));
  const line = cells => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
}

function block(node, options) {
  switch (node.type) {
    case 'paragraph':
      return inline(node.content, options);
    case 'heading':
      return `${'#'.repeat(Math.min(6, Math.max(1, node.attrs?.level ?? 1)))} ${inline(node.content, options).replace(/\s*\n/g, ' ')}`;
    case 'horizontalRule':
      return '---';
    case 'codeBlock':
      return fence((node.content ?? []).map(c => c.text ?? '').join(''), node.attrs?.language ?? '');
    case 'blockquote':
      return blocks(node.content, options).split('\n').map(l => (l ? `> ${l}` : '>')).join('\n');
    case 'image':
      return image(node, options);
    case 'table':
      return table(node, options);
    case 'text':
    case 'hardBreak':
      return inline([node], options);
    default:
      // Unknown node: keep whatever readable content it has rather than dropping it.
      return Array.isArray(node.content) ? blocks(node.content, options) : (node.text ?? '');
  }
}

function blocks(nodes, options, tight = false) {
  if (!Array.isArray(nodes)) return '';
  let out = '', previousWasList = false, number = 0;
  for (const node of nodes) {
    const isList = node.type === 'list';
    let text;
    if (isList) {
      const { kind, checked, order } = node.attrs ?? {};
      let marker;
      if (kind === 'ordered') {
        number = order ?? number + 1;
        marker = `${number}. `;
      } else {
        number = 0;
        marker = kind === 'task' ? `- [${checked ? 'x' : ' '}] ` : '- ';
      }
      // Continuation lines and nested items align with the item's text.
      const indent = ' '.repeat(kind === 'ordered' ? marker.length : 2);
      text = marker + blocks(node.content, options, true).split('\n').map((l, i) => (i && l ? indent + l : l)).join('\n');
    } else {
      text = block(node, options);
      if (text === '') continue; // empty paragraphs are only spacing in the editor
      number = 0;
    }
    if (out) out += tight || (isList && previousWasList) ? '\n' : '\n\n';
    out += text;
    previousWasList = isList;
  }
  return out;
}
