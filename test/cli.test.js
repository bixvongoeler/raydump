import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodeRaycfg3, encodeWrapped, encodeClassic, sampleExport, tempDir, runCli, PNG } from './helpers.js';

const PASSWORD = 'correct horse';
const PASSWORD_ENV = { RAYCAST_EXPORT_PASSWORD: PASSWORD };

/** Writes an export into a fresh temp dir and returns paths for it. */
function setup(t, file = encodeRaycfg3(sampleExport, { password: PASSWORD })) {
  const dir = tempDir(t);
  const input = join(dir, 'Raycast 2026-01-02.rayconfig');
  writeFileSync(input, file);
  const out = join(dir, 'out');
  return { dir, input, out, read: path => readFileSync(join(out, path), 'utf8') };
}

const filesIn = dir => (existsSync(dir) ? readdirSync(dir).sort() : []);

test('extracts every section of an encrypted export', t => {
  const { input, out, read } = setup(t);
  const result = runCli([input, '-o', out], { env: PASSWORD_ENV });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');

  assert.deepEqual(filesIn(out), ['ai-chats', 'clipboard-files', 'clipboard.md', 'json', 'notes', 'quicklinks.md', 'snippets.md', 'transcriptions.md']);

  // JSON: one file per category plus the export header, without the encryption parameters.
  assert.deepEqual(filesIn(join(out, 'json')), ['_export-header.json', 'ai.json', 'clipboardHistory.json', 'notes.json', 'quicklinks.json', 'settings.json', 'snippets.json']);
  for (const [category, value] of Object.entries(sampleExport)) {
    assert.deepEqual(JSON.parse(read(`json/${category}.json`)), value);
    assert.equal(read(`json/${category}.json`), JSON.stringify(value, null, 2) + '\n');
  }
  assert.deepEqual(JSON.parse(read('json/_export-header.json')), { exportedAt: '2026-01-02T03:04:05.000Z', appVersion: '2.0.0.0', schemaVersion: 3 });

  // Notes: rich text becomes Markdown, same-named notes do not overwrite each other, images are saved and linked.
  assert.deepEqual(filesIn(join(out, 'notes')), ['Trip plan.md', 'images', 'trip plan (2).md']);
  assert.equal(read('notes/Trip plan.md'), [
    '---', 'id: NOTE1', 'created: 2026-01-01T00:00:00.000Z', 'updated: 2026-01-02T00:00:00.000Z', 'pinned: true', '---',
    '# Trip plan', '', 'Pack **light**.', '', '- [x] Passport', '- [ ] Tickets', '', '![map](images/map.png)', '',
  ].join('\n'));
  assert.match(read('notes/trip plan (2).md'), /pinned: false\n---\nPlain text only\n$/);
  assert.deepEqual(readFileSync(join(out, 'notes', 'images', 'map.png')), PNG);

  // Chats: grouped by source, named by date and title, messages in chronological order.
  assert.deepEqual(filesIn(join(out, 'ai-chats')), ['chat', 'orphaned', 'quick_ai']);
  assert.deepEqual(filesIn(join(out, 'ai-chats', 'chat')), ['2026-01-02 Greek letters.md']);
  assert.deepEqual(filesIn(join(out, 'ai-chats', 'quick_ai')), ['2026-01-03 Convert 5 miles to km.md']);
  assert.deepEqual(filesIn(join(out, 'ai-chats', 'orphaned')), ['2026-01-05 Orphaned question.md']);
  const chat = read('ai-chats/chat/2026-01-02 Greek letters.md');
  assert.match(chat, /^# Greek letters\n\n- \*\*Chat ID:\*\* CHAT1\n- \*\*Source:\*\* chat\n- \*\*Model:\*\* model-a\n/);
  assert.match(chat, /<details><summary>System instructions<\/summary>\n\n```\nBe brief\.\n```/);
  const order = ['## User · 2026-01-02 10:00:00 UTC', 'What is alpha?', '_Attachment: my file.png (image/png)_', '## Assistant · model-a · 2026-01-02 10:00:01 UTC',
    '<summary>Reasoning</summary>', 'Tool call: <code>web-search</code> (completed)', '"query": "alpha"', 'search result', 'Alpha is the first letter.', '- [Greek alphabet](https://example.com/greek)'];
  const positions = order.map(s => chat.indexOf(s));
  assert.ok(positions.every(p => p >= 0), `missing: ${order.filter((_, i) => positions[i] < 0).join(' / ')}`);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.equal(chat.match(/^## /gm).length, 2, 'consecutive assistant messages share one heading');
  assert.match(read('ai-chats/quick_ai/2026-01-03 Convert 5 miles to km.md'), /About 8 km\.\n\n_\(canceled\)_/);

  assert.equal(read('transcriptions.md'), '# Dictation transcriptions\n\n### 2026-01-06 08:00:00 UTC · Notes · 3s · 2 words\n\nHello there.\n\n<details><summary>Raw transcription</summary>\n\nhello there\n\n</details>\n');
  assert.equal(read('snippets.md'), '# Snippets\n\n## Signature — `/sig`\n\n```\nBest,\nSam\n```\n\n_Used 12× · created 2026-01-01 00:00:00 UTC · updated 2026-01-01 00:00:00 UTC_\n');
  assert.match(read('quicklinks.md'), /\| Search \\\| Docs \| `https:\/\/example\.com\/\?q=\{query\}` \| Browser \| 4 \| 2026-01-01 00:00:00 UTC \|\n$/);

  // Clipboard: newest first, text fenced safely, both images saved under distinct names.
  const clipboard = read('clipboard.md');
  const headings = clipboard.match(/^### .*$/gm);
  assert.deepEqual(headings, ['### 2026-01-08 12:00:00 UTC · Browser · image', '### 2026-01-07 12:00:00 UTC · Editor · text · copied 3×', '### 2026-01-06 12:00:00 UTC · image']);
  assert.match(clipboard, /````\ncopied ```text```\n````/);
  assert.match(clipboard, /Stored on disk \(image\/png\): `\/Users\/someone\/Library\/clipboard\/file-1\.png`/);
  assert.match(clipboard, /Text recognised in image:\n\n```\ntext in the image\n```/);
  assert.deepEqual(filesIn(join(out, 'clipboard-files')), ['00001-bbb222 (2).png', '00001-bbb222.png']);
  assert.match(clipboard, /Saved: \[clipboard-files\/00001-bbb222 \(2\)\.png\]\(<clipboard-files\/00001-bbb222 \(2\)\.png>\)/);
  assert.deepEqual(readFileSync(join(out, 'clipboard-files', '00001-bbb222.png')), PNG);

  // Summary
  assert.match(result.stdout, /^Raycast 2\.0\.0\.0 export from 2026-01-02T03:04:05\.000Z -> .*out\n/);
  assert.match(result.stdout, /\n\s+6 {2}categories as JSON\s+json\/\n/);
  assert.match(result.stdout, /\n\s+3 {2}AI chats\s+ai-chats\/\n/);
  assert.match(result.stdout, /\n\s+1 {2}note images\s+notes\/images\/\n/);
  assert.match(result.stdout, /not encrypted/);
});

test('takes the password from --password', t => {
  const { input, out } = setup(t);
  const result = runCli([input, '--output', out, '--password', PASSWORD, '--quiet']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(existsSync(join(out, 'notes', 'Trip plan.md')));
});

test('a wrong password fails without writing anything', t => {
  const { input, out } = setup(t);
  const result = runCli([input, '-o', out, '-p', 'nope']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Incorrect password/);
  assert.equal(result.stdout, '');
  assert.equal(existsSync(out), false);
});

test('asks for --password when there is no terminal to prompt on', t => {
  const { input, out } = setup(t);
  const result = runCli([input, '-o', out]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /encrypted\. Pass --password, or set \$RAYCAST_EXPORT_PASSWORD/);
  assert.equal(existsSync(out), false);
});

test('an unencrypted export needs no password', t => {
  const { input, out } = setup(t, encodeRaycfg3(sampleExport));
  const result = runCli([input, '-o', out]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(out, 'snippets.md')));
});

test('names the output folder after the export by default', t => {
  const { dir, input } = setup(t);
  const result = runCli([input], { cwd: dir, env: PASSWORD_ENV });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(dir, 'Raycast 2026-01-02', 'json', 'notes.json')));
});

test('--only and --skip choose sections', t => {
  const { input, out, dir } = setup(t);
  assert.equal(runCli([input, '-o', out, '--only', 'notes, snippets'], { env: PASSWORD_ENV }).status, 0);
  assert.deepEqual(filesIn(out), ['notes', 'snippets.md']);

  const other = join(dir, 'other');
  assert.equal(runCli([input, '-o', other, '--skip', 'json,clipboard,chats'], { env: PASSWORD_ENV }).status, 0);
  assert.deepEqual(filesIn(other), ['notes', 'quicklinks.md', 'snippets.md', 'transcriptions.md']);
});

test('rejects unknown sections and conflicting flags as usage errors', t => {
  const { input, out } = setup(t);
  const unknown = runCli([input, '-o', out, '--only', 'notes,emails'], { env: PASSWORD_ENV });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown section for --only: emails/);
  assert.equal(runCli([input, '--only', 'notes', '--skip', 'json'], { env: PASSWORD_ENV }).status, 2);
  assert.equal(runCli([input, '--bogus'], { env: PASSWORD_ENV }).status, 2);
  assert.equal(existsSync(out), false);
});

test('--raw writes the decrypted JSON unchanged', t => {
  const jsonText = '{"settings":{"big":12345678901234567890,"spaced" : [1, 2]},"emoji":"🎉"}';
  const { input, out, dir } = setup(t, encodeRaycfg3(jsonText, { password: PASSWORD }));

  const toStdout = runCli([input, '--raw', '-'], { env: PASSWORD_ENV });
  assert.equal(toStdout.status, 0, toStdout.stderr);
  assert.equal(toStdout.stdout, jsonText);

  const rawFile = join(dir, 'raw.json');
  assert.equal(runCli([input, '--raw', rawFile, '-o', out], { env: PASSWORD_ENV }).status, 0);
  assert.equal(readFileSync(rawFile, 'utf8'), jsonText);
  assert.equal(existsSync(out), false, '--raw writes nothing else');
});

test('JSON output keeps integers that JavaScript numbers cannot hold', t => {
  const { input, out, read } = setup(t, encodeRaycfg3('{"settings":{"big":12345678901234567890}}', { password: PASSWORD }));
  assert.equal(runCli([input, '-o', out], { env: PASSWORD_ENV }).status, 0);
  assert.equal(read('json/settings.json'), '{\n  "big": 12345678901234567890\n}\n');
});

test('refuses to write into a folder with files unless --force is given', t => {
  const { input, out } = setup(t);
  mkdirSync(out);
  writeFileSync(join(out, 'keep.txt'), 'mine');

  const refused = runCli([input, '-o', out], { env: PASSWORD_ENV });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /already has files in it/);
  assert.deepEqual(filesIn(out), ['keep.txt']);

  assert.equal(runCli([input, '-o', out, '--force'], { env: PASSWORD_ENV }).status, 0);
  assert.equal(readFileSync(join(out, 'keep.txt'), 'utf8'), 'mine');
  assert.ok(existsSync(join(out, 'notes', 'Trip plan.md')));
});

test('writes into an existing empty folder', t => {
  const { input, out } = setup(t);
  mkdirSync(out);
  assert.equal(runCli([input, '-o', out], { env: PASSWORD_ENV }).status, 0);
  assert.ok(existsSync(join(out, 'json')));
});

for (const schemaVersion of [1, 2]) {
  test(`extracts an older Raycast 2.x export (schema ${schemaVersion})`, t => {
    const { input, out, read } = setup(t, encodeWrapped(sampleExport, { password: PASSWORD, schemaVersion }));
    const result = runCli([input, '-o', out], { env: PASSWORD_ENV });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(out, 'ai-chats', 'chat', '2026-01-02 Greek letters.md')));
    assert.deepEqual(JSON.parse(read('json/_export-header.json')), { schemaVersion, exportedAt: '2026-01-02T03:04:05.000Z', appVersion: '2.0.0.0' });
  });
}

test('extracts a Raycast 1.x export as JSON', t => {
  const classic = { builtin_package_snippets: { snippets: [{ name: 'sig', text: 'Best' }] }, raycast_themes: [] };
  const { input, out, read } = setup(t, encodeClassic(classic, { password: PASSWORD }));
  const result = runCli([input, '-o', out], { env: PASSWORD_ENV });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(filesIn(out), ['json']);
  assert.deepEqual(filesIn(join(out, 'json')), ['builtin_package_snippets.json', 'raycast_themes.json']);
  assert.deepEqual(JSON.parse(read('json/builtin_package_snippets.json')), classic.builtin_package_snippets);
  assert.match(result.stdout, /^Raycast 1\.x export -> /);
  assert.match(result.stdout, /written as JSON only/);
});

test('a malformed category is reported but does not stop the rest', t => {
  const broken = { ...sampleExport, notes: { notes: [null] } };
  const { input, out } = setup(t, encodeRaycfg3(broken, { password: PASSWORD }));
  const result = runCli([input, '-o', out], { env: PASSWORD_ENV });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Warning: Could not write notes \(/);
  assert.ok(existsSync(join(out, 'json', 'notes.json')), 'the JSON is still written');
  assert.ok(existsSync(join(out, 'snippets.md')), 'later sections are still written');
});

test('categories with unexpected shapes are skipped quietly', t => {
  const odd = { notes: null, ai: 'text', snippets: { snippets: 'nope' }, quicklinks: {}, clipboardHistory: { clipboardEntries: [{}] }, extra: [1] };
  const { input, out } = setup(t, encodeRaycfg3(odd));
  const result = runCli([input, '-o', out]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(filesIn(out), ['clipboard.md', 'json']);
  assert.equal(filesIn(join(out, 'json')).length, 7);
});

test('reports files that are not exports', t => {
  const dir = tempDir(t);
  const input = join(dir, 'random.rayconfig');
  writeFileSync(input, Buffer.alloc(2048, 3));
  const result = runCli([input, '-p', 'x']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Incorrect password, or this is not a Raycast export/);

  const missing = runCli([join(dir, 'missing.rayconfig')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Cannot read .*missing\.rayconfig \(ENOENT\)/);
});

test('--help, --version and missing arguments', () => {
  const help = runCli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage: raycast-export-extractor <export\.rayconfig> \[options\]/);
  assert.match(help.stdout, /Sections: json, notes, chats, transcriptions, snippets, quicklinks, clipboard/);

  const version = runCli(['--version']);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);

  const none = runCli([]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /^No export file given\n\nUsage:/);
});
