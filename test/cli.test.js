import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { encodeRaycfg3, encodeWrapped, encodeClassic, sampleExport, classicExport, tempDir, runCli, PNG } from './helpers.js';

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
const modified = path => statSync(path).mtime.toISOString();

test('extracts every section of an encrypted export', t => {
  const { input, out, read } = setup(t);
  const result = runCli([input, '-o', out], { env: PASSWORD_ENV });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');

  assert.deepEqual(filesIn(out), ['ai-chats', 'ai-memory.md', 'clipboard-files', 'clipboard.md', 'json', 'notes', 'quicklinks.md', 'settings.md', 'snippets.md', 'transcriptions.md']);

  // JSON: one file per category plus the export header, without the encryption parameters.
  assert.deepEqual(filesIn(join(out, 'json')), ['_export-header.json', 'ai.json', 'clipboardHistory.json', 'nodeExtensions.json', 'notes.json', 'quicklinks.json', 'settings.json', 'snippets.json']);
  for (const [category, value] of Object.entries(sampleExport)) {
    assert.deepEqual(JSON.parse(read(`json/${category}.json`)), value);
    assert.equal(read(`json/${category}.json`), JSON.stringify(value, null, 2) + '\n');
  }
  assert.deepEqual(JSON.parse(read('json/_export-header.json')), { exportedAt: '2026-01-02T03:04:05.000Z', appVersion: '2.0.0.0', schemaVersion: 3 });

  // Notes: rich text becomes Markdown, same-named notes do not overwrite each other, images are saved and linked.
  // Each note carries a link that opens it in Raycast.
  assert.deepEqual(filesIn(join(out, 'notes')), ['Trip plan.md', 'images', 'trip plan (2).md']);
  assert.equal(read('notes/Trip plan.md'), [
    '---', 'id: NOTE1', 'created: 2026-01-01T00:00:00.000Z', 'updated: 2026-01-02T00:00:00.000Z', 'pinned: true',
    'raycast: raycast://extensions/raycast/raycast-notes/raycast-notes?arguments=%7B%22id%22%3A%22NOTE1%22%7D', '---',
    '# Trip plan', '', 'Pack **light**.', '', '- [x] Passport', '- [ ] Tickets', '', '![map](images/map.png)', '',
  ].join('\n'));
  assert.match(read('notes/trip plan (2).md'), /pinned: false\nraycast: raycast:\/\/\S+NOTE2%22%7D\n---\nPlain text only\n$/);
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
  assert.match(result.stdout, /\n\s+7 {2}categories as JSON\s+json\/\n/);
  assert.match(result.stdout, /\n\s+3 {2}AI chats\s+ai-chats\/\n/);
  assert.match(result.stdout, /\n\s+2 {2}AI memories\s+ai-memory\.md\n/);
  assert.match(result.stdout, /\n\s+21 {2}settings\s+settings\.md\n/);
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
  assert.deepEqual(filesIn(other), ['ai-memory.md', 'notes', 'quicklinks.md', 'settings.md', 'snippets.md', 'transcriptions.md']);

  const third = join(dir, 'third');
  assert.equal(runCli([input, '-o', third, '--only', 'settings'], { env: PASSWORD_ENV }).status, 0);
  assert.deepEqual(filesIn(third), ['settings.md']);
  // Without the memory file to point at, the memory is shown with the other settings.
  assert.match(readFileSync(join(third, 'settings.md'), 'utf8'), /\| AI memory \| see below \|\n[\s\S]*\*\*AI memory\*\*\n\n```\n\*\*Work\*\*\n\nLikes short answers\.\n```\n/);
});

test('files are dated like the things they hold', t => {
  const { input, out } = setup(t);
  assert.equal(runCli([input, '-o', out], { env: PASSWORD_ENV }).status, 0);
  assert.equal(modified(join(out, 'notes', 'Trip plan.md')), '2026-01-02T00:00:00.000Z');
  assert.equal(modified(join(out, 'ai-chats', 'chat', '2026-01-02 Greek letters.md')), '2026-01-02T10:01:00.000Z');
  // A chat with no record of its own is dated by its last message.
  assert.equal(modified(join(out, 'ai-chats', 'orphaned', '2026-01-05 Orphaned question.md')), '2026-01-05T00:00:00.000Z');
  assert.equal(modified(join(out, 'clipboard-files', '00001-bbb222.png')), '2026-01-08T12:00:00.000Z');
  assert.equal(modified(join(out, 'ai-memory.md')), '2026-01-10T00:00:00.000Z');
  assert.equal(modified(join(out, 'settings.md')), '2026-01-02T03:04:05.000Z');

  // Raycast 1.x writes chat dates without a time zone; they are UTC.
  const classic = setup(t, encodeClassic(classicExport));
  assert.equal(runCli([classic.input, '-o', classic.out]).status, 0);
  assert.equal(modified(join(classic.out, 'notes', 'Groceries.md')), '2025-01-02T00:00:00.000Z');
  assert.equal(modified(join(classic.out, 'ai-chats', '2025-02-03 sram vs dram.md')), '2025-02-03T04:05:09.000Z');
});

test('writes AI memory and a readable list of settings', t => {
  const { input, out, read } = setup(t);
  assert.equal(runCli([input, '-o', out], { env: PASSWORD_ENV }).status, 0);

  // The general memory comes from the settings, a project's memory from its chat folder. Headings inside
  // the remembered text are pushed down to sit under the file's own; fenced text is left alone.
  assert.equal(read('ai-memory.md'), [
    '# AI memory', '', '_What Raycast AI has remembered from your chats, as it stood when the export was made._', '',
    '## General memory', '', '_Last updated 2026-01-10 00:00:00 UTC_', '', '**Work**', '', 'Likes short answers.', '',
    '## Project memory: Garden', '', '_Last updated 2026-01-09 00:00:00 UTC · memory is turned off_', '',
    '### Project Memory', '', '- Tomatoes need sun.', '', '```', '# not a heading', '```', '',
  ].join('\n'));

  assert.equal(read('settings.md'), [
    '# Raycast settings', '',
    '_A readable view of `json/settings.json`, exported from Raycast 2.0.0.0 at 2026-01-02 03:04:05 UTC. Usage history, theme colours and anything that looks like a credential are left to the JSON._', '',
    '## General', '', '| Setting | Value |', '|---|---|',
    '| Open at login | yes |', '| Appearance | `dark` |', '| UI zoom | 1.1 |', '| Additional certificate authorities | none |',
    '| Global hotkey | ⌘ Space |', '| Installation date | 2025-12-01 00:00:00 UTC |', '',
    // Commands are named from their ids; ones made from the user's data are looked up in the category that holds them.
    '## Hotkeys', '', '| Command | Hotkey |', '|---|---|',
    '| AI › Fix Writing | double-tap right ⌘ |', '| Clipboard History › History | ⌃⌥⇧⌘ V |', '| Window Management › Left Half | ⇧⌘ alone |', '',
    '## Aliases', '', '| Command | Alias |', '|---|---|', '| Quicklinks › Search \\| Docs | `docs` |', '',
    '## Favorites', '', '1. Clipboard History › History', '',
    '## Fallback commands', '', '1. Quicklinks › Search | Docs', '',
    '## Extensions', '',
    '### Installed', '', '| Extension | Author | State |', '|---|---|---|', '| Tooth Pick | sam | on |', '',
    '### Built in', '', '| Extension | State |', '|---|---|', '| AI | on |', '| Windows Taskbar | off |', '',
    // Shortcuts have no name in the export, so they are counted.
    '## Disabled commands', '', '- **Apple Shortcuts:** 2 shortcuts', '- **Tooth Pick:** Connect Device', '',
    '## Extension settings', '', '### AI', '', '| Setting | Value |', '|---|---|',
    '| AI memory | see `ai-memory.md` |', '| AI memory enabled | yes |', '| AI memory last updated | 2026-01-10 00:00:00 UTC |',
    '| AI BYOK API keys | hidden (see the JSON) |', '| AI profile | see below |', '| Skill directories | `~/skills`, `*.tmp` |',
    '| Auto quit rules | see below |', '| Widgets › End | `clock` |', '| Weather location | empty |', '| Default editor | not set |', '',
    '**AI profile**', '', '```', 'Line one', 'Line two', '```', '',
    '**Auto quit rules**', '', '- Name: `Mail`, Interval minutes: 3', '',
    // When a command last ran is not a setting.
    '## Command settings', '', '| Command | Setting | Value |', '|---|---|---|', '| Tooth Pick › Connect Device | Delta | 64 |', '',
    '## Themes', '', '- Night (dark)', '',
  ].join('\n'));
  assert.ok(!read('settings.md').includes('sk-secret-value'));
});

test('an export without settings or memory to show writes neither file', t => {
  const bare = { settings: { general: {}, internalExtensions: [{ id: 'e:r:ai', enabled: true, meta: { aiMemory: ' ' } }], schemaVersion: 1 }, ai: { folders: [{ id: 'F1', name: 'Empty' }] } };
  const { input, out } = setup(t, encodeRaycfg3(bare));
  const result = runCli([input, '-o', out, '--only', 'memory']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(filesIn(out), []);
  assert.equal(runCli([input, '-o', out, '--only', 'settings,memory', '--force']).status, 0);
  assert.deepEqual(filesIn(out), ['settings.md']); // the blank memory is still a setting
  assert.equal(runCli([setup(t, encodeRaycfg3({ settings: { schemaVersion: 1 } })).input, '-o', join(out, 'none'), '--only', 'settings']).status, 0);
  assert.deepEqual(filesIn(join(out, 'none')), []);
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

test('extracts a Raycast 1.x export as JSON and Markdown', t => {
  const { input, out, read } = setup(t, encodeClassic(classicExport, { password: PASSWORD }));
  const result = runCli([input, '-o', out], { env: PASSWORD_ENV });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');

  assert.deepEqual(filesIn(out), ['ai-chats', 'floating-notes.md', 'json', 'notes', 'quicklinks.md', 'settings.md', 'snippets.md']);
  assert.deepEqual(filesIn(join(out, 'json')), Object.keys(classicExport).map(key => `${key}.json`).sort());
  for (const [category, value] of Object.entries(classicExport)) assert.deepEqual(JSON.parse(read(`json/${category}.json`)), value);

  // Notes: the rich text is base64 JSON; a note whose document cannot be read falls back to its plain text.
  assert.deepEqual(filesIn(join(out, 'notes')), ['Groceries.md', 'Scratch.md']);
  const link = id => `raycast: raycast://extensions/raycast/raycast-notes/raycast-notes?context=%7B%22id%22%3A%22${id}%22%7D`;
  assert.equal(read('notes/Groceries.md'), ['---', 'id: N1', 'created: 2025-01-01T00:00:00Z', 'updated: 2025-01-02T00:00:00Z', link('N1'), '---', 'Buy **today**', '', '- [ ] Milk', ''].join('\n'));
  assert.equal(read('notes/Scratch.md'), `---\nid: N2\ncreated: 2025-01-04T00:00:00Z\nupdated: 2025-01-04T00:00:00Z\n${link('N2')}\n---\nPlain text only\n`);
  assert.equal(read('floating-notes.md'), 'call the bank\n');

  // Chats: one file each, named by date and title, messages in chronological order, dates read as UTC.
  assert.deepEqual(filesIn(join(out, 'ai-chats')), ['2025-02-03 sram vs dram.md', '2025-02-04 Named chat.md']);
  assert.equal(read('ai-chats/2025-02-03 sram vs dram.md'), [
    '# sram vs dram?', '',
    '- **Chat ID:** C1', '- **Model:** model-x', '- **Created:** 2025-02-03 04:05:06 UTC', '- **Updated:** 2025-02-03 04:05:09 UTC', '',
    '## User · 2025-02-03 04:05:06 UTC', '', 'sram vs dram?', 'briefly', '', '_Attachment: chip.png (image/png)_', '',
    '## Assistant · model-x · 2025-02-03 04:05:09 UTC', '', 'Static RAM is faster.', '', '_(canceled)_', '',
  ].join('\n'));
  assert.match(read('ai-chats/2025-02-04 Named chat.md'), /^# Named chat\n\n- \*\*Chat ID:\*\* C2\n- \*\*Model:\*\* model-y\n- \*\*Created:\*\* 2025-02-04 00:00:00 UTC\n\n## User · 2025-02-04 00:00:00 UTC\n\nHello\n$/);

  assert.equal(read('snippets.md'), '# Snippets\n\n## Email — `@@`\n\n```\nsam@example.com\n```\n\n_Used 4× · created 2025-01-01 00:00:00 UTC · updated 2025-01-05 00:00:00 UTC_\n');
  assert.equal(read('quicklinks.md'), [
    '# Quicklinks', '', '| Name | Link | Opens with | Opened | Updated |', '|---|---|---|---|---|',
    '| Search | `https://example.com/?q={argument}` | com.example.Browser | 3 | 2025-01-01 00:00:00 UTC |',
    '| Old (disabled) | `https://example.org` |  | 0 | 2025-01-02 00:00:00 UTC |', '',
  ].join('\n'));

  // Settings: gathered from the feature categories; hotkeys and aliases come from root search, and a password is not shown.
  assert.equal(read('settings.md'), [
    '# Raycast settings', '',
    '_A readable view of the settings in `json/`, from Raycast 1.100.0. Usage history and anything that looks like a credential are left to the JSON._', '',
    '## General', '', '| Setting | Value |', '|---|---|', '| Raycast global hotkey | ⌘ Space |', '',
    '## Advanced', '', '| Setting | Value |', '|---|---|', '| Pop to root timeout | 60 |', '',
    '## Hotkeys', '', '| Command | Hotkey |', '|---|---|', '| Brew › Clean Up | ⌃⇧ F3 |', '| Window Management Left Half | ⌥⌘ ← |', '',
    '## Aliases', '', '| Command | Alias |', '|---|---|', '| Editor | `ed` |', '| Search | `s` |', '',
    '## Extensions', '', '| Extension | Author | Commands on |', '|---|---|---|', '| Brew | sam | 1 of 2 |', '',
    '### Extension preferences', '', '| Extension | Setting | Value |', '|---|---|---|',
    '| Brew | API token | hidden (see the JSON) |', '| Brew › Clean Up | Greedy | yes |', '',
    '## Open AI', '', '| Setting | Value |', '|---|---|', '| AI chat presets | none |', '| AI commands | none |', '',
    '## Quicklinks', '', '| Setting | Value |', '|---|---|', '| Enable quick search | no |', '',
    '## Clipboard History', '', '| Setting | Value |', '|---|---|', '| Clipboard history enable link preview | yes |', '',
  ].join('\n'));

  assert.match(result.stdout, /^Raycast 1\.x export -> /);
  assert.match(result.stdout, /\n\s+10 {2}categories as JSON\s+json\/\n/);
  assert.match(result.stdout, /\n\s+12 {2}settings\s+settings\.md\n/);
  assert.match(result.stdout, /\n\s+2 {2}notes\s+notes\/\n/);
  assert.match(result.stdout, /\n\s+1 {2}floating note\s+floating-notes\.md\n/);
  assert.match(result.stdout, /\n\s+2 {2}AI chats\s+ai-chats\/\n/);
  assert.doesNotMatch(result.stdout, /JSON only/);
});

test('--only and --skip choose sections of a Raycast 1.x export', t => {
  const { input, out } = setup(t, encodeClassic(classicExport));
  assert.equal(runCli([input, '-o', out, '--only', 'notes']).status, 0);
  assert.deepEqual(filesIn(out), ['floating-notes.md', 'notes']);
  assert.equal(runCli([input, '-o', out, '--force', '--skip', 'json,notes,chats']).status, 0);
  assert.deepEqual(filesIn(out), ['floating-notes.md', 'notes', 'quicklinks.md', 'settings.md', 'snippets.md']);
});

test('a Raycast 1.x export with nothing to read as Markdown is written as JSON only', t => {
  const empty = { builtin_package_raycastNotes: { notes: [] }, builtin_package_floatingNotes: { note: ' \n' }, 'builtin_package_open-ai': { aiChats: [] }, builtin_package_snippets: { snippets: [] }, raycast_themes: [] };
  const { input, out, read } = setup(t, encodeClassic(empty, { password: PASSWORD }));
  const result = runCli([input, '-o', out], { env: PASSWORD_ENV });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(filesIn(out), ['json']);
  assert.deepEqual(JSON.parse(read('json/raycast_themes.json')), []);
  assert.match(result.stdout, /^Raycast 1\.x export -> .*\n\n\s+5 {2}categories as JSON\s+json\/\n\nThese files/);
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
  assert.match(help.stdout, /^Usage: raydump <export\.rayconfig> \[options\]/);
  assert.match(help.stdout, /\nSections: json, notes, chats, memory, transcriptions, snippets, quicklinks, clipboard, settings\n$/);

  const version = runCli(['--version']);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);

  const none = runCli([]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /^No export file given\n\nUsage:/);
});
