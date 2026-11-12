import { test } from 'node:test';
import assert from 'node:assert/strict';
import { richTextToMarkdown } from '../src/richtext.js';

const text = (value, ...marks) => ({ type: 'text', text: value, ...(marks.length ? { marks: marks.map(m => (typeof m === 'string' ? { type: m } : m)) } : {}) });
const p = (...content) => ({ type: 'paragraph', content });
const item = (kind, content, attrs = {}) => ({ type: 'list', attrs: { kind, checked: false, order: null, ...attrs }, content });
const doc = (...content) => ({ type: 'doc', content });
const md = (...content) => richTextToMarkdown(doc(...content));

test('headings, paragraphs and rules', () => {
  assert.equal(
    md({ type: 'heading', attrs: { level: 2 }, content: [text('Title')] }, p(text('Body')), { type: 'horizontalRule' }, p(text('End'))),
    '## Title\n\nBody\n\n---\n\nEnd',
  );
});

test('empty paragraphs are dropped', () => {
  assert.equal(md(p(text('a')), { type: 'paragraph' }, p(), p(text('b'))), 'a\n\nb');
});

test('inline marks', () => {
  assert.equal(md(p(text('bold', 'bold'), text(' '), text('italic', 'italic'), text(' '), text('both', 'bold', 'italic'))), '**bold** *italic* ***both***');
  assert.equal(md(p(text('code', 'code'), text(' '), text('a`b', 'code'))), '`code` `` a`b ``');
  assert.equal(md(p(text('gone', 'strike'), text(' '), text('under', 'underline'), text(' '), text('lit', 'highlight'))), '~~gone~~ <u>under</u> <mark>lit</mark>');
});

test('emphasis markers stay tight against the text', () => {
  assert.equal(md(p(text('a'), text(' bold ', 'bold'), text('b'))), 'a **bold** b');
  assert.equal(md(p(text('   ', 'bold'))), '   ');
});

test('links', () => {
  assert.equal(md(p(text('site', { type: 'link', attrs: { href: 'https://example.com' } }))), '[site](https://example.com)');
  assert.equal(md(p(text('odd', 'bold', { type: 'link', attrs: { href: 'https://example.com/a b(c)' } }))), '[**odd**](<https://example.com/a b(c)>)');
});

test('hard breaks', () => {
  assert.equal(md(p(text('one'), { type: 'hardBreak' }, text('two'))), 'one  \ntwo');
});

test('bullet, task and ordered lists', () => {
  assert.equal(md(item('bullet', [p(text('a'))]), item('bullet', [p(text('b'))])), '- a\n- b');
  assert.equal(md(item('task', [p(text('todo'))]), item('task', [p(text('done'))], { checked: true })), '- [ ] todo\n- [x] done');
  assert.equal(md(item('ordered', [p(text('a'))]), item('ordered', [p(text('b'))]), item('ordered', [p(text('c'))])), '1. a\n2. b\n3. c');
});

test('ordered lists honour an explicit start and restart after other content', () => {
  assert.equal(md(item('ordered', [p(text('c'))], { order: 3 }), item('ordered', [p(text('d'))])), '3. c\n4. d');
  assert.equal(md(item('ordered', [p(text('a'))]), p(text('break')), item('ordered', [p(text('b'))])), '1. a\n\nbreak\n\n1. b');
});

test('nested lists are indented under their parent', () => {
  const nested = item('bullet', [p(text('parent')), item('bullet', [p(text('child')), item('ordered', [p(text('deep'))])]), item('bullet', [p(text('child 2'))])]);
  assert.equal(md(nested, item('bullet', [p(text('sibling'))])), '- parent\n  - child\n    1. deep\n  - child 2\n- sibling');
});

test('list items keep multi-line content aligned', () => {
  assert.equal(md(item('ordered', [p(text('one'), { type: 'hardBreak' }, text('two'))])), '1. one  \n   two');
});

test('lists are separated from surrounding blocks', () => {
  assert.equal(md(p(text('Intro:')), item('bullet', [p(text('a'))]), item('bullet', [p(text('b'))]), p(text('Outro'))), 'Intro:\n\n- a\n- b\n\nOutro');
});

test('code blocks', () => {
  assert.equal(md({ type: 'codeBlock', attrs: { language: 'js' }, content: [text('let a = 1;\nlet b = 2;')] }), '```js\nlet a = 1;\nlet b = 2;\n```');
  assert.equal(md({ type: 'codeBlock', attrs: { language: null }, content: [text('```\nnested\n```')] }), '````\n```\nnested\n```\n````');
  assert.equal(md({ type: 'codeBlock' }), '```\n\n```');
});

test('blockquotes', () => {
  assert.equal(md({ type: 'blockquote', content: [p(text('quoted')), p(text('more'))] }), '> quoted\n>\n> more');
});

test('images resolve through their attachment id', () => {
  const image = { type: 'image', attrs: { attachmentId: 'ABC-1', alt: 'a [map]' } };
  assert.equal(richTextToMarkdown(doc(image), { resolveImage: id => (id === 'abc-1' ? 'images/my map.png' : undefined) }), '![a map](<images/my map.png>)');
  assert.equal(md(image), '![a map](attachment:abc-1)');
  assert.equal(md({ type: 'image', attrs: { src: 'https://example.com/x.png' } }), '![](https://example.com/x.png)');
});

test('tables', () => {
  const cell = (type, value) => ({ type, content: [p(text(value))] });
  const table = {
    type: 'table',
    content: [
      { type: 'tableRow', content: [cell('tableHeader', 'Name'), cell('tableHeader', 'Value')] },
      { type: 'tableRow', content: [cell('tableCell', 'a|b'), cell('tableCell', '1')] },
    ],
  };
  assert.equal(md(table), '| Name | Value |\n| --- | --- |\n| a\\|b | 1 |');
});

test('unknown nodes keep their readable content', () => {
  assert.equal(md({ type: 'callout', content: [p(text('inside'))] }, p(text('x'), { type: 'mystery', text: '?' }, { type: 'atom' })), 'inside\n\nx?');
});

test('missing or malformed documents produce an empty string', () => {
  assert.equal(richTextToMarkdown(undefined), '');
  assert.equal(richTextToMarkdown(null), '');
  assert.equal(richTextToMarkdown({ type: 'doc' }), '');
  assert.equal(richTextToMarkdown({ type: 'doc', content: 'nope' }), '');
});
