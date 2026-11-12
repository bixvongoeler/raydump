import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeName, safeFileName, uniqueNamer, fence, timestamp, compareDates, linkTarget, tableCell } from '../src/markdown.js';

test('safeName removes characters that are invalid on any platform', () => {
  assert.equal(safeName('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
  assert.equal(safeName('  spaced \n\t out  '), 'spaced out');
  assert.equal(safeName('control\x00\x1fchars'), 'control chars');
});

test('safeName avoids names the file system would reject or hide', () => {
  assert.equal(safeName(''), 'Untitled');
  assert.equal(safeName(undefined), 'Untitled');
  assert.equal(safeName('???'), 'Untitled');
  assert.equal(safeName('..'), 'Untitled');
  assert.equal(safeName('.hidden'), 'hidden');
  assert.equal(safeName('trailing dots. . .'), 'trailing dots');
  assert.equal(safeName('CON'), '_CON');
  assert.equal(safeName('lpt1'), '_lpt1');
  assert.equal(safeName('console'), 'console');
});

test('safeName limits length in bytes without splitting characters', () => {
  const name = safeName('🎉'.repeat(100), 30);
  assert.equal(name, '🎉'.repeat(7));
  assert.ok(Buffer.byteLength(safeName('日本語'.repeat(100))) <= 150);
  assert.equal(safeName('a'.repeat(500)).length, 150);
});

test('safeFileName keeps the extension', () => {
  assert.equal(safeFileName('my: photo.PNG'), 'my photo.PNG');
  assert.equal(safeFileName(`${'x'.repeat(300)}.jpeg`, 20), `${'x'.repeat(15)}.jpeg`);
  assert.equal(safeFileName('no extension'), 'no extension');
  assert.equal(safeFileName('.png'), 'Untitled.png');
});

test('uniqueNamer disambiguates names that collide on case-insensitive file systems', () => {
  const name = uniqueNamer();
  assert.equal(name('Note', '.md'), 'Note.md');
  assert.equal(name('note', '.md'), 'note (2).md');
  assert.equal(name('NOTE', '.md'), 'NOTE (3).md');
  assert.equal(name('Note', '.txt'), 'Note.txt');
  assert.equal(name('é', '.md'), 'é.md');
  assert.equal(name('é', '.md'), 'é (2).md'); // same text, different Unicode normalisation
});

test('fence outgrows any backtick run in the content', () => {
  assert.equal(fence('plain'), '```\nplain\n```');
  assert.equal(fence('a ``` b', 'js'), '````js\na ``` b\n````');
  assert.equal(fence('`````'), '``````\n`````\n``````');
});

test('timestamp formats ISO dates and leaves other values alone', () => {
  assert.equal(timestamp('2026-11-12T20:40:08.227Z'), '2026-11-12 20:40:08 UTC');
  assert.equal(timestamp('2026-11-12T20:40:08Z'), '2026-11-12 20:40:08 UTC');
  assert.equal(timestamp('yesterday'), 'yesterday');
  assert.equal(timestamp(1700000000), '1700000000');
  assert.equal(timestamp(undefined), '');
});

test('compareDates sorts chronologically across formats', () => {
  const dates = ['2026-01-02T00:00:00Z', '2026-01-01T00:00:00.500Z', '2026-01-01T00:00:00Z'];
  assert.deepEqual([...dates].sort(compareDates), ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00.500Z', '2026-01-02T00:00:00Z']);
  assert.equal(compareDates(undefined, '2026-01-01T00:00:00Z'), 0);
});

test('linkTarget and tableCell escape what Markdown would misread', () => {
  assert.equal(linkTarget('plain/path.png'), 'plain/path.png');
  assert.equal(linkTarget('my file (1).png'), '<my file (1).png>');
  assert.equal(tableCell('a|b\nc'), 'a\\|b c');
});
