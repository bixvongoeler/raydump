// Test helpers: writers for each export format (the inverse of src/container.js),
// a small synthetic export, and a runner for the command line tool.
// No real user data is used anywhere in the tests.

import { createCipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/raydump.js', import.meta.url));

const toJsonBytes = data => Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));

/** Raycast 2.x, schema 3: the RAYCFG3 container. `data` may be an object or raw JSON text. */
export function encodeRaycfg3(data, { password, header = {} } = {}) {
  const meta = { exportedAt: '2026-01-02T03:04:05.000Z', appVersion: '2.0.0.0', schemaVersion: 3, ...header };
  let body = gzipSync(toJsonBytes(data));
  let tag = Buffer.alloc(0);
  if (password) {
    const salt = randomBytes(16), iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
    body = Buffer.concat([cipher.update(body), cipher.final()]);
    tag = cipher.getAuthTag();
    meta.encryption = { iv: iv.toString('hex'), salt: salt.toString('hex') };
  }
  const head = gzipSync(Buffer.from(JSON.stringify(meta)));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(head.length);
  return Buffer.concat([Buffer.from('RAYCFG3\n', 'ascii'), length, head, body, tag]);
}

/** Raycast 2.x, schema 1 and 2: a gzipped JSON wrapper with the payload as hex. */
export function encodeWrapped(data, { password, schemaVersion = 2 } = {}) {
  const wrapper = { schemaVersion, exportedAt: '2026-01-02T03:04:05.000Z', appVersion: '2.0.0.0' };
  let body = toJsonBytes(data);
  if (schemaVersion >= 2) body = gzipSync(body);
  if (password) {
    const salt = randomBytes(16), iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
    body = Buffer.concat([cipher.update(body), cipher.final()]);
    wrapper.encryption = { salt: salt.toString('hex'), iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex') };
  }
  wrapper.data = body.toString('hex');
  return gzipSync(Buffer.from(JSON.stringify(wrapper)));
}

/** Raycast 1.x: gzip, optionally AES-256-CBC with a SHA-256 key and the IV in front. */
export function encodeClassic(data, { password } = {}) {
  const compressed = gzipSync(toJsonBytes(data));
  if (!password) return compressed;
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', createHash('sha256').update(password).digest(), iv);
  return Buffer.concat([iv, cipher.update(compressed), cipher.final()]);
}

// A 1x1 transparent PNG.
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks: marks.map(type => ({ type })) } : {}) });
const paragraph = (...content) => ({ type: 'paragraph', content });
const hotkey = (modifiers, code) => ({ kind: { type: 'SingleStep', shortcut: { modifiers: modifiers.map(modifier => ({ modifier })), key: { type: 'LayoutIndependent', code } } }, locality: 'Global' });
const STORE_EXTENSION = '11111111-2222-3333-4444-555555555555';

/** A made-up export covering every section the tool writes. */
export const sampleExport = {
  ai: {
    chats: [
      { id: 'CHAT1', title: 'Greek letters', modelId: 'model-a', source: 'chat', createdAt: '2026-01-02T10:00:00.000Z', updatedAt: '2026-01-02T10:01:00.000Z', systemInstructions: 'Be brief.' },
      { id: 'CHAT2', title: '', modelId: 'model-b', source: 'quick_ai', createdAt: '2026-01-03T09:00:00.000Z', updatedAt: '2026-01-03T09:00:05.000Z' },
      { id: 'EMPTY', title: 'No messages', source: 'chat', createdAt: '2026-01-04T00:00:00.000Z' },
    ],
    messages: [
      // Deliberately out of order: the writer sorts by createdAt.
      { id: 'M3', chatId: 'CHAT1', role: 'assistant', modelId: 'model-a', status: 'completed', createdAt: '2026-01-02T10:00:03.000Z', content: { type: 'text', text: 'Alpha is the first letter.', references: [{ title: 'Greek alphabet', url: 'https://example.com/greek' }] } },
      { id: 'M1', chatId: 'CHAT1', role: 'user', status: 'completed', createdAt: '2026-01-02T10:00:00.000Z', content: { type: 'user-query', text: 'What is alpha?', attachments: [{ filename: 'my%20file.png', contentType: 'image/png' }] } },
      { id: 'M2', chatId: 'CHAT1', role: 'tool', status: 'completed', createdAt: '2026-01-02T10:00:02.000Z', content: { type: 'tool', name: 'web-search', runStatus: 'completed', arguments: { query: 'alpha' }, result: [{ type: 'text', text: 'search result' }] } },
      { id: 'M0', chatId: 'CHAT1', role: 'assistant', modelId: 'model-a', status: 'completed', createdAt: '2026-01-02T10:00:01.000Z', content: { type: 'reasoning', reasoning: 'Thinking about letters.' } },
      { id: 'Q1', chatId: 'CHAT2', role: 'user', status: 'completed', createdAt: '2026-01-03T09:00:00.000Z', content: { type: 'user-query', text: 'Convert 5 miles to km?\nSecond line' } },
      { id: 'Q2', chatId: 'CHAT2', role: 'assistant', modelId: 'model-b', status: 'canceled', createdAt: '2026-01-03T09:00:05.000Z', content: { type: 'text', text: 'About 8 km.' } },
      { id: 'O1', chatId: 'GONE', role: 'user', status: 'completed', createdAt: '2026-01-05T00:00:00.000Z', content: { type: 'user-query', text: 'Orphaned question' } },
    ],
    transcriptions: [
      { id: 'T1', status: 'success', value: 'Hello there.', rawValue: 'hello there', wordCount: 2, duration: 3, applicationName: 'Notes', startedAt: '2026-01-06T08:00:00.000Z' },
    ],
    // One chat folder with a memory of its own. Its text has a heading, and a fenced line that only looks like one.
    folders: [{ id: 'F1', name: 'Garden', memory: '# Project Memory\n\n- Tomatoes need sun.\n\n```\n# not a heading\n```', memoryLastUpdatedAt: '2026-01-09T00:00:00.000Z', memoryEnabled: false }],
    commands: [{ id: 'CMD1', name: 'Fix Writing' }],
    schemaVersion: 1,
  },
  clipboardHistory: {
    clipboardEntries: [
      { title: 'copied text', items: [{ representations: [{ content: 'copied ```text```', contentType: 'text', mimeType: 'text/plain;charset=utf-8' }, { content: '<b>copied</b>', contentType: 'text', mimeType: 'text/html' }] }], categories: ['text'], tags: [], source: { name: 'Editor' }, copyCount: 3, contentHash: 'aaa111', createdAt: '2026-01-07T12:00:00Z' },
      { title: 'Image', items: [{ representations: [{ content: PNG.toString('base64'), contentType: 'blob', mimeType: 'image/png' }, { content: PNG.toString('base64'), contentType: 'blob', mimeType: 'image/png' }, { content: 'text in the image', contentType: 'text', mimeType: 'application/vnd.raycast.ocr' }] }], categories: ['image'], source: { name: 'Browser' }, copyCount: 1, contentHash: 'bbb222', createdAt: '2026-01-08T12:00:00Z' },
      { title: 'Screenshot', items: [{ representations: [{ content: '/Users/someone/Library/clipboard/file-1.png', contentType: 'url', mimeType: 'image/png' }] }], categories: ['image'], copyCount: 1, contentHash: 'ccc333', createdAt: '2026-01-06T12:00:00Z' },
    ],
    schemaVersion: 1,
  },
  notes: {
    notes: [
      {
        id: 'NOTE1', title: 'Trip: plan?', pinned: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', text: 'Trip plan',
        rawContent: {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 1 }, content: [text('Trip plan')] },
            paragraph(text('Pack '), text('light', ['bold']), text('.')),
            { type: 'list', attrs: { kind: 'task', checked: true }, content: [paragraph(text('Passport'))] },
            { type: 'list', attrs: { kind: 'task', checked: false }, content: [paragraph(text('Tickets'))] },
            { type: 'image', attrs: { attachmentId: 'IMG-1', alt: 'map' } },
          ],
        },
      },
      { id: 'NOTE2', title: 'trip: plan?', createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z', text: 'Plain text only' },
    ],
    images: [{ id: 'img-1', filename: 'map.png', checksum: 'unused', content: PNG.toString('base64') }],
    schemaVersion: 2,
  },
  quicklinks: {
    quicklinks: [{ id: 'QL1', name: 'Search | Docs', link: 'https://example.com/?q={query}', openWith: 'Browser', openCount: 4, createdAt: '2026-01-01T00:00:00.000Z' }],
    schemaVersion: 1,
  },
  nodeExtensions: { extensions: [{ uuid: STORE_EXTENSION, name: 'tooth-pick', author: 'sam' }], schemaVersion: 1 },
  settings: {
    general: { openAtLogin: true, appearance: 'dark', uiZoom: 1.1, additionalCertificateAuthorities: [], globalHotkey: hotkey(['Meta'], 49) },
    commands: [
      { id: 'c:r:clipboard-history::-::history', extensionId: 'e:r:clipboard-history', enabled: true, macosHotkey: hotkey(['Meta', 'Shift', 'Alt', 'Ctrl'], 9), favoriteOrder: 0 },
      { id: 'c:r:quicklinks::*::quicklink::=::QL1', extensionId: 'e:r:quicklinks', enabled: true, alias: 'docs', fallbackOrder: 0 },
      { id: `c:n:${STORE_EXTENSION}::-::connect-device`, extensionId: `e:n:${STORE_EXTENSION}`, enabled: false, meta: { ranAt: 1767312000000, delta: 64 } },
      { id: 'c:r:apple-shortcuts::*::shortcut::=::SHORTCUT-1', extensionId: 'e:r:apple-shortcuts', enabled: false },
      { id: 'c:r:apple-shortcuts::*::shortcut::=::SHORTCUT-2', extensionId: 'e:r:apple-shortcuts', enabled: false },
      { id: 'c:r:ai::*::aiCommand::=::CMD1', extensionId: 'e:r:ai', enabled: true, macosHotkey: { kind: { type: 'DoubleTap', shortcut: { modifier: { modifier: 'Meta', directionality: 'right' } } }, locality: 'Global' } },
      { id: 'c:r:window-management::-::leftHalf', extensionId: 'e:r:window-management', enabled: true, macosHotkey: { kind: { type: 'SingleKey', shortcut: { type: 'Modifiers', modifiers: [{ modifier: 'Shift' }, { modifier: 'Meta' }] } }, locality: 'Global' } },
    ],
    internalExtensions: [
      {
        id: 'e:r:ai', enabled: true,
        meta: {
          aiMemory: '**Work**\n\nLikes short answers.', aiMemoryEnabled: true, aiMemoryLastUpdated: '2026-01-10T00:00:00.000Z',
          aiByokApiKeys: [{ provider: 'example', key: 'sk-secret-value' }], aiProfile: 'Line one\nLine two',
          skillDirectories: ['~/skills', '*.tmp'], autoQuitRules: [{ name: 'Mail', intervalMinutes: 3 }], widgets: { end: ['clock'] }, weatherLocation: '', defaultEditor: null,
        },
      },
      { id: 'e:r:windows-taskbar', enabled: false },
    ],
    nodeExtensions: [{ id: `e:n:${STORE_EXTENSION}`, enabled: true }],
    themes: [{ id: 'TH1', name: 'Night', appearance: 'dark', background: '#000000' }],
    installationDate: '2025-12-01T00:00:00.000Z',
    schemaVersion: 1,
  },
  snippets: {
    snippets: [{ id: 'SN1', title: 'Signature', keyword: '/sig', text: 'Best,\nSam', copyCount: 12, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    schemaVersion: 1,
  },
};

const classicDocument = content => Buffer.from(JSON.stringify({ type: 'doc', content })).toString('base64');

/** A made-up Raycast 1.x export: the same kinds of data under other keys and field names. */
export const classicExport = {
  raycast_version: '1.100.0',
  builtin_package_raycastNotes: {
    provider_schemaVersion: 1,
    notes: [
      {
        id: 'N1', title: 'Groceries', documentSchemaVersion: 2, text: 'Buy today\nMilk', createdAt: '2025-01-01T00:00:00Z', modifiedAt: '2025-01-02T00:00:00Z', openedAt: '2025-01-03T00:00:00Z',
        document: classicDocument([
          paragraph(text('Buy '), text('today', ['bold'])),
          { type: 'list', attrs: { kind: 'task', order: null, checked: false }, content: [paragraph(text('Milk'))] },
        ]),
      },
      { id: 'N2', title: 'Scratch', document: 'not a document', text: 'Plain text only', createdAt: '2025-01-04T00:00:00Z', modifiedAt: '2025-01-04T00:00:00Z' },
    ],
  },
  builtin_package_floatingNotes: { provider_schemaVersion: 1, note: 'call the bank' },
  'builtin_package_open-ai': {
    provider_schemaVersion: 1,
    aiChatPresets: [],
    aiCommands: [],
    aiChats: [
      {
        record: { id: 'C1', title: '', model: 'model-x', platform: 'macOS', createdAt: '2025-02-03 04:05:06.789', modifiedAt: '2025-02-03 04:05:09.000', accessedAt: '2025-02-03 04:05:09.000' },
        // Deliberately out of order: the writer sorts by timestamp. The attachment fields are a guess;
        // no real 1.x export with attachments was available, so the writer accepts the usual spellings.
        messages: [
          { id: 'M2', chatId: 'C1', source: 'assistant', modelUsed: 'model-x', text: 'Static RAM is faster.', timestamp: '2025-02-03 04:05:09.000', isCancelled: true, platform: 'macOS' },
          { id: 'M1', chatId: 'C1', source: 'user', text: 'sram vs dram?\nbriefly', timestamp: '2025-02-03 04:05:06.789', isCancelled: false, attachments: [{ name: 'chip.png', type: 'image/png' }], platform: 'macOS' },
        ],
      },
      { record: { id: 'C2', title: 'Named chat', model: 'model-y', createdAt: '2025-02-04 00:00:00.000' }, messages: [{ id: 'M3', chatId: 'C2', source: 'user', text: 'Hello', timestamp: '2025-02-04 00:00:00.000' }] },
      { record: { id: 'EMPTY', title: 'No messages' }, messages: [] },
    ],
  },
  builtin_package_snippets: {
    provider_schemaVersion: 1,
    snippets: [{ name: 'Email', alias: '@@', text: 'sam@example.com', category: 'text', copyCount: 4, createdAt: '2025-01-01T00:00:00Z', modifiedAt: '2025-01-05T00:00:00Z', accessedAt: '2025-01-06T00:00:00Z' }],
  },
  builtin_package_quicklinks: {
    provider_schemaVersion: 1,
    enableQuickSearch: false,
    quicklinks: [
      { uuid: 'Q1', name: 'Search', url: 'https://example.com/?q={argument}', openCount: 3, isEnabled: true, updatedAt: '2025-01-01T00:00:00Z', applicationID: 'com.example.Browser' },
      { uuid: 'Q2', name: 'Old', url: 'https://example.org', openCount: 0, isEnabled: false, updatedAt: '2025-01-02T00:00:00Z' },
    ],
  },
  builtin_package_clipboardHistory: { provider_schemaVersion: 1, clipboardHistoryEnableLinkPreview: true },
  builtin_package_raycastPreferences: {
    provider_schemaVersion: 1,
    preferencesGeneral: { raycastGlobalHotkey: 'Command-49' },
    preferencesAdvanced: { popToRootTimeout: 60, didMigrateSomething: true },
  },
  builtin_package_rootSearch: {
    provider_schemaVersion: 1,
    rootSearch: [
      { key: 'builtin_command_windowManagementLeftHalf', type: 'command', hotkey: 'Option-Command-123' },
      { key: 'com.example.Editor', type: 'systemApp', path: '/Applications/Editor.app', alias: 'ed' },
      { key: 'raycastQuicklink_Q1', type: 'quicklink', alias: 's' },
      { key: 'extension_brew.clean-up__0000', type: 'nodeCommand', hotkey: 'Shift-Control-99' },
      { key: 'com.example.Unused', type: 'systemApp', path: '/Applications/Unused.app' },
    ],
  },
  builtin_package_raycastExtensions: {
    provider_schemaVersion: 1,
    extensions: [{
      name: 'brew', title: 'Brew', owner: 'sam',
      commands: [{ name: 'search', enabled: true }, { name: 'clean-up', enabled: false, prefs: [{ name: 'greedy', type: 'checkbox', value: true }] }],
      prefs: [{ name: 'apiToken', type: 'password', value: 'tok-secret-value' }, { name: 'unset', type: 'textfield' }],
    }],
  },
};

/** Creates a temporary directory that is removed when the test (or suite) ends. */
export function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'rayconfig-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Runs the CLI in a child process. `env` entries replace the inherited ones. */
export function runCli(args, { cwd, env = {} } = {}) {
  const inherited = { ...process.env };
  delete inherited.RAYCAST_EXPORT_PASSWORD;
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, env: { ...inherited, ...env }, encoding: 'buffer' });
  return { status: result.status, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8'), stdoutBytes: result.stdout };
}
