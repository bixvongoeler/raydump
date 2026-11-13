// Readable views of the settings and of what Raycast AI remembers.
//
// Settings differ between Raycast versions and gain keys with every release, so most of
// this is generic: key names become words and values become short text. Only hotkeys,
// command ids and a few lists get special treatment. Anything that looks like a credential
// is named but not shown; the JSON files have it.

import { posix } from 'node:path';
import { fence, timestamp, tableCell, codeSpan, toDate } from './markdown.js';

const list = value => (Array.isArray(value) ? value : []);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const join = parts => parts.join('\n\n') + '\n';
const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(row => `| ${row.map(tableCell).join(' | ')} |`)].join('\n');
const byFirst = (a, b) => String(a[0]).localeCompare(String(b[0]));

// ---------------------------------------------------------------- names and values

const ACRONYMS = new Map(Object.entries({
  ai: 'AI', api: 'API', id: 'ID', ids: 'IDs', ui: 'UI', url: 'URL', urls: 'URLs', ocr: 'OCR', mcp: 'MCP',
  hdr: 'HDR', ntfs: 'NTFS', byok: 'BYOK', os: 'OS', macos: 'macOS', px: 'px', rem: 'rem',
}));

/**
 * "aiChatAskQuestionsEnabled" -> "AI chat ask questions enabled"; "window-management" -> "Window management".
 * @param {{ title?: boolean, capital?: boolean }} [options] capitalise every word, or none
 */
export function humanize(key, { title = false, capital = true } = {}) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/).filter(Boolean)
    .map((word, i) => ACRONYMS.get(word.toLowerCase())
      ?? (title || (capital && i === 0) ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()))
    .join(' ');
}

const LONG = 100;
const SECRET = /api.?key|token|secret|password|credential/i;
const HIDDEN = 'hidden (see the JSON)';
const isEmpty = v => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (isObject(v) && !Object.keys(v).length);

/** A value as text short enough for a table cell, or undefined when it needs more room. */
function shortValue(value, key = '') {
  if (value === null || value === undefined) return 'not set';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return /(At|Date)$/.test(key) && value > 1e11 ? timestamp(new Date(value).toISOString()) : String(value);
  if (typeof value === 'string') {
    if (value === '') return 'empty';
    if (value.length > LONG || value.includes('\n')) return undefined;
    const date = timestamp(value);
    return date === value ? codeSpan(value) : date;
  }
  if (Array.isArray(value)) {
    if (!value.length) return 'none';
    const items = value.map(v => (isObject(v) || Array.isArray(v) ? undefined : shortValue(v)));
    return items.every(item => item !== undefined) && items.join(', ').length <= LONG ? items.join(', ') : undefined;
  }
  return undefined;
}

/** A value too long for a table cell, as a block of its own. */
function longValue(value) {
  if (typeof value === 'string') return fence(value);
  const item = v => (isObject(v)
    ? Object.entries(v).map(([k, x]) => `${humanize(k)}: ${SECRET.test(k) && !isEmpty(x) ? HIDDEN : shortValue(x, k) ?? codeSpan(JSON.stringify(x))}`).join(', ')
    : shortValue(v) ?? codeSpan(typeof v === 'string' ? v : JSON.stringify(v)));
  return list(value).map(v => `- ${item(v)}`).join('\n');
}

/**
 * Turns an object of settings into table rows, plus blocks for values too long for a cell.
 * Nested objects are flattened into "Parent › Child" rows.
 * @param {{ mac?: boolean, prefix?: string, special?: (key: string, value: unknown) => string | null | undefined }} [options]
 *   `special` may return the text for a value, or null to leave the setting out
 */
function describe(object, options = {}) {
  const { mac = true, prefix = '', special = () => undefined } = options;
  const rows = [], blocks = [];
  for (const [key, value] of Object.entries(object ?? {})) {
    const label = prefix + humanize(key);
    const custom = special(key, value);
    if (custom === null) continue;
    if (custom !== undefined) rows.push([label, custom]);
    else if (SECRET.test(key) && !isEmpty(value)) rows.push([label, HIDDEN]);
    else if (isHotkey(value)) rows.push([label, formatHotkey(value, mac)]);
    else if (isObject(value) && Object.keys(value).length) {
      const inner = describe(value, { ...options, prefix: `${label} › ` });
      rows.push(...inner.rows);
      blocks.push(...inner.blocks);
    } else {
      const text = isObject(value) ? 'none' : shortValue(value, key);
      rows.push([label, text ?? 'see below']);
      if (text === undefined) blocks.push([label, longValue(value)]);
    }
  }
  return { rows, blocks };
}

const section = (heading, { rows, blocks }) =>
  (rows.length ? [heading, table(['Setting', 'Value'], rows), ...blocks.map(([label, body]) => `**${label}**\n\n${body}`)] : []);

// ---------------------------------------------------------------- hotkeys

// macOS virtual key codes, which is how both Raycast versions record a hotkey's key.
const MAC_KEYS = {
  0: 'A', 1: 'S', 2: 'D', 3: 'F', 4: 'H', 5: 'G', 6: 'Z', 7: 'X', 8: 'C', 9: 'V', 10: '§', 11: 'B', 12: 'Q', 13: 'W', 14: 'E', 15: 'R',
  16: 'Y', 17: 'T', 18: '1', 19: '2', 20: '3', 21: '4', 22: '6', 23: '5', 24: '=', 25: '9', 26: '7', 27: '-', 28: '8', 29: '0', 30: ']',
  31: 'O', 32: 'U', 33: '[', 34: 'I', 35: 'P', 36: 'Return', 37: 'L', 38: 'J', 39: "'", 40: 'K', 41: ';', 42: '\\', 43: ',', 44: '/',
  45: 'N', 46: 'M', 47: '.', 48: 'Tab', 49: 'Space', 50: '`', 51: 'Delete', 53: 'Escape', 64: 'F17', 65: 'Keypad .', 67: 'Keypad *',
  69: 'Keypad +', 71: 'Clear', 75: 'Keypad /', 76: 'Enter', 78: 'Keypad -', 79: 'F18', 80: 'F19', 81: 'Keypad =', 82: 'Keypad 0',
  83: 'Keypad 1', 84: 'Keypad 2', 85: 'Keypad 3', 86: 'Keypad 4', 87: 'Keypad 5', 88: 'Keypad 6', 89: 'Keypad 7', 90: 'F20',
  91: 'Keypad 8', 92: 'Keypad 9', 96: 'F5', 97: 'F6', 98: 'F7', 99: 'F3', 100: 'F8', 101: 'F9', 103: 'F11', 105: 'F13', 106: 'F16',
  107: 'F14', 109: 'F10', 111: 'F12', 113: 'F15', 114: 'Help', 115: 'Home', 116: 'Page Up', 117: 'Forward Delete', 118: 'F4',
  119: 'End', 120: 'F2', 121: 'Page Down', 122: 'F1', 123: '←', 124: '→', 125: '↓', 126: '↑',
};
// In the order macOS shows them.
const MODIFIERS = [['Ctrl', '⌃', 'Ctrl'], ['Alt', '⌥', 'Alt'], ['Shift', '⇧', 'Shift'], ['Meta', '⌘', 'Win']];

function modifiers(names, mac) {
  const known = MODIFIERS.filter(([name]) => names.includes(name)).map(([, symbol, word]) => (mac ? symbol : word));
  const other = names.filter(name => name && !MODIFIERS.some(([known]) => known === name));
  return [...known, ...other].join(mac && !other.length ? '' : '+');
}

const keyName = (code, mac) => (mac && MAC_KEYS[code]) || `key code ${code}`;

const isHotkey = value => isObject(value) && isObject(value.kind) && typeof value.kind.type === 'string' && isObject(value.kind.shortcut);

/** A Raycast 2.x hotkey, such as "⌥⌘ T", "⇧⌘ alone" (the modifier keys by themselves) or "double-tap right ⌘". */
export function formatHotkey(hotkey, mac = true) {
  const { type, shortcut } = hotkey.kind;
  if (type === 'DoubleTap' && isObject(shortcut.modifier)) {
    return ['double-tap', shortcut.modifier.directionality, modifiers([shortcut.modifier.modifier], mac)].filter(Boolean).join(' ');
  }
  const held = modifiers(list(shortcut.modifiers).map(m => m?.modifier), mac);
  if (isObject(shortcut.key) && shortcut.key.code !== undefined) return [held, keyName(shortcut.key.code, mac)].filter(Boolean).join(mac ? ' ' : '+');
  return held ? `${held} alone` : codeSpan(JSON.stringify(hotkey.kind));
}

const CLASSIC_MODIFIERS = { Control: 'Ctrl', Option: 'Alt', Shift: 'Shift', Command: 'Meta' };

/** A Raycast 1.x hotkey: "Option-Command-125" -> "⌥⌘ ↓". */
export function formatClassicHotkey(text) {
  const parts = String(text).split('-');
  const code = parts.pop();
  if (!/^\d+$/.test(code)) return codeSpan(text);
  return [modifiers(parts.map(p => CLASSIC_MODIFIERS[p] ?? p), true), keyName(Number(code), true)].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- Raycast 2.x settings

const TITLE = { title: true };
const namesById = items => new Map(list(items).filter(i => i?.id && i.name).map(i => [i.id, i.name]));

/**
 * Names for the ids that settings use. A command id is "c:r:<extension>::-::<command>" for a
 * fixed command and "c:r:<extension>::*::<kind>::=::<value>" for one made from the user's own
 * data (a quicklink, a script, an app); "r" extensions are built in and "n" ones come from
 * the Store, where the name is looked up in the nodeExtensions category.
 */
function namer(ctx) {
  const store = new Map(list(ctx.lookup('nodeExtensions')?.extensions).filter(e => e?.uuid).map(e => [e.uuid, e]));
  const lookups = {
    quicklink: () => namesById(ctx.lookup('quicklinks')?.quicklinks),
    aiCommand: () => namesById(ctx.lookupMember('ai', 'commands')),
    transcriptionStyle: () => namesById(ctx.lookupMember('ai', 'transcriptionStyles')),
    layoutGroup: () => namesById(ctx.lookup('windowLayouts')?.windowLayouts),
  };
  const loaded = new Map();
  const dynamicName = (kind, value) => {
    if (kind === 'scriptCommand') return posix.basename(value);
    if (kind === 'application') return /\.app$/.test(value) ? posix.basename(value, '.app') : undefined; // some are recorded as an opaque id
    if (!lookups[kind]) return undefined;
    if (!loaded.has(kind)) loaded.set(kind, lookups[kind]());
    return loaded.get(kind).get(value);
  };

  const extension = id => {
    const [, source, name = String(id)] = /^[ce]:([a-z]):(.*)$/s.exec(String(id)) ?? [];
    if (source !== 'n') return humanize(name, TITLE);
    return store.has(name) ? humanize(store.get(name).name ?? name, TITLE) : `Extension ${name.slice(0, 8)}`;
  };
  const command = id => {
    const [head, marker, ...rest] = String(id).split('::');
    const base = { extension: extension(head), named: true };
    if (marker === '-') return { ...base, name: humanize(rest.join('::'), TITLE) };
    if (marker !== '*') return { ...base, name: String(id) };
    const kind = rest[0], value = rest.slice(2).join('::');
    const name = dynamicName(kind, value);
    return name ? { ...base, kind, name } : { ...base, kind, name: `${humanize(kind, { capital: false })} ${codeSpan(value)}`, named: false };
  };
  return { extension, author: id => store.get(String(id).replace(/^e:n:/, ''))?.author, command, full: id => (c => `${c.extension} › ${c.name}`)(command(id)) };
}

// What a command last did, as opposed to how it is set up.
const COMMAND_STATE = new Set(['ranAt', 'runError', 'applicationMissing', 'scriptCommandFileMissing']);

export function writeSettings(settings, out, ctx) {
  const header = ctx.header ?? {};
  const mac = !/windows/i.test(String(header.osName ?? ''));
  const names = namer(ctx);
  const commands = list(settings.commands).filter(c => isObject(c) && c.id);
  const onOff = value => (value === false ? 'off' : 'on');
  let count = 0;
  const counted = described => (count += described.rows.length, described);

  // The system's name can end in its major version ("macOS 27"), which the full version repeats.
  const os = header.osName && [header.osVersion ? String(header.osName).replace(/\s+\d+(\.\d+)*$/, '') : header.osName, header.osVersion].filter(Boolean).join(' ');
  const from = [header.appVersion && `Raycast ${header.appVersion}`, os && `on ${os}`].filter(Boolean).join(' ');
  const parts = [
    '# Raycast settings',
    `_A readable view of \`json/settings.json\`${from ? `, exported from ${from}` : ''}${header.exportedAt ? ` at ${timestamp(header.exportedAt)}` : ''}. `
      + 'Usage history, theme colours and anything that looks like a credential are left to the JSON._',
  ];

  parts.push(...section('## General', counted(describe(
    { ...(isObject(settings.general) ? settings.general : {}), installationDate: settings.installationDate, firstKnownVersion: settings.firstKnownVersion },
    { mac, special: (key, value) => (value === undefined ? null : undefined) },
  ))));

  const hotkey = command => {
    for (const [key, value] of Object.entries(command)) {
      if (/hotkey$/i.test(key) && isHotkey(value)) return formatHotkey(value, /^macos/i.test(key) || (mac && !/^windows/i.test(key)));
    }
  };
  const hotkeys = commands.filter(hotkey).map(c => [names.full(c.id), hotkey(c)]).sort(byFirst);
  if (hotkeys.length) parts.push('## Hotkeys', table(['Command', 'Hotkey'], hotkeys));
  const aliases = commands.filter(c => typeof c.alias === 'string' && c.alias).map(c => [names.full(c.id), codeSpan(c.alias)]).sort(byFirst);
  if (aliases.length) parts.push('## Aliases', table(['Command', 'Alias'], aliases));
  count += hotkeys.length + aliases.length;

  const ordered = (key, heading) => {
    const items = commands.filter(c => typeof c[key] === 'number').sort((a, b) => a[key] - b[key]);
    if (items.length) parts.push(heading, items.map((c, i) => `${i + 1}. ${names.full(c.id)}`).join('\n'));
  };
  ordered('favoriteOrder', '## Favorites');
  ordered('fallbackOrder', '## Fallback commands');

  const builtIn = list(settings.internalExtensions).filter(e => isObject(e) && e.id);
  const installed = list(settings.nodeExtensions).filter(e => isObject(e) && e.id);
  if (builtIn.length || installed.length) parts.push('## Extensions');
  if (installed.length) {
    parts.push('### Installed', table(['Extension', 'Author', 'State'], installed.map(e => [names.extension(e.id), names.author(e.id) ?? '', onOff(e.enabled)]).sort(byFirst)));
  }
  if (builtIn.length) parts.push('### Built in', table(['Extension', 'State'], builtIn.map(e => [names.extension(e.id), onOff(e.enabled)]).sort(byFirst)));

  // Commands that are switched off, by extension. Ones made from the user's data that cannot be named are counted.
  const off = new Map();
  for (const c of commands) {
    if (c.enabled !== false) continue;
    const { extension, name, kind, named } = names.command(c.id);
    if (!off.has(extension)) off.set(extension, { names: [], unnamed: new Map() });
    if (named) off.get(extension).names.push(name);
    else off.get(extension).unnamed.set(kind, (off.get(extension).unnamed.get(kind) ?? 0) + 1);
  }
  if (off.size) {
    const lines = [...off].sort(byFirst).map(([extension, group]) => {
      const counts = [...group.unnamed].map(([kind, n]) => `${n} ${humanize(kind, { capital: false })}${n === 1 ? '' : 's'}`);
      return `- **${extension}:** ${[...group.names.sort(), ...counts].join(', ')}`;
    });
    parts.push('## Disabled commands', lines.join('\n'));
  }

  const memoryFile = ctx.sections?.has('memory');
  const extensionSettings = builtIn.filter(e => isObject(e.meta) && Object.keys(e.meta).length).flatMap(e => section(`### ${names.extension(e.id)}`, counted(describe(e.meta, {
    mac,
    special: (key, value) => (key === 'aiMemory' && typeof value === 'string' && value.trim() && memoryFile ? 'see `ai-memory.md`' : undefined),
  }))));
  if (extensionSettings.length) parts.push('## Extension settings', ...extensionSettings);

  const commandRows = commands.flatMap(c => {
    const own = Object.fromEntries(Object.entries(isObject(c.meta) ? c.meta : {}).filter(([key]) => !COMMAND_STATE.has(key)));
    return describe(own, { mac }).rows.map(([label, value]) => [names.full(c.id), label, value === 'see below' ? 'see the JSON' : value]);
  }).sort(byFirst);
  if (commandRows.length) parts.push('## Command settings', table(['Command', 'Setting', 'Value'], commandRows));
  count += commandRows.length;

  const themes = list(settings.themes).filter(t => t?.name);
  if (themes.length) parts.push('## Themes', themes.map(t => `- ${t.name}${t.appearance ? ` (${t.appearance})` : ''}`).join('\n'));

  if (!count) return [];
  out.write('settings.md', join(parts), { modified: toDate(header.exportedAt) });
  return [{ count, label: 'settings', path: 'settings.md' }];
}

// ---------------------------------------------------------------- Raycast 1.x settings

// Raycast 1.x spreads its settings over one category per feature, next to that feature's data.
const CLASSIC_PREFIX = /^(builtin_package_|remote_package_|raycast_)/;
const CLASSIC_OTHER_CATEGORIES = new Set([
  'raycast_user_activity', 'raycast_onboarding', 'raycast_version', 'raycast_app_defaults',
  'builtin_package_raycastPreferences', 'builtin_package_rootSearch', 'builtin_package_raycastExtensions',
]);
const CLASSIC_DATA_KEYS = new Set([
  'provider_schemaVersion', 'notes', 'note', 'aiChats', 'snippets', 'quicklinks', 'dictionaryRecentWords', 'disabledSiriShortcutIds',
]);
const MAX_SETTINGS_BYTES = 1 << 20;

/** The name of something in Raycast 1.x root search: an app, a command, a script, a quicklink. */
function classicItemName(item, quicklinks) {
  const key = String(item.key ?? '');
  let m;
  if ((m = /^extension_([^.]+)\.(.+?)__/.exec(key))) return `${humanize(m[1], TITLE)} › ${humanize(m[2], TITLE)}`;
  if ((m = /^builtin_command_(.+)$/.exec(key))) return humanize(m[1], TITLE);
  if ((m = /^raycastScript_(.+)$/.exec(key))) return posix.basename(m[1]);
  if ((m = /^raycastQuicklink_(.+)$/.exec(key))) return quicklinks.get(m[1]) ?? `Quicklink ${m[1]}`;
  if (typeof item.path === 'string' && item.path) return posix.basename(item.path).replace(/\.(app|appex|prefPane)$/, '');
  return key;
}

export function writeClassicSettings(preferences, out, ctx) {
  let count = 0;
  const special = (key, value) => {
    if (CLASSIC_DATA_KEYS.has(key) || /^didMigrate/.test(key)) return null; // data, and one-off upgrade flags
    return /hotkey$/i.test(key) && typeof value === 'string' ? formatClassicHotkey(value) : undefined;
  };
  const add = (heading, object) => {
    const described = describe(object, { special });
    count += described.rows.length;
    return section(heading, described);
  };

  const version = ctx.lookup('raycast_version');
  const parts = [
    '# Raycast settings',
    `_A readable view of the settings in \`json/\`${typeof version === 'string' ? `, from Raycast ${version}` : ''}. `
      + 'Usage history and anything that looks like a credential are left to the JSON._',
  ];

  // Preferences come grouped: preferencesGeneral, preferencesAppearance, preferencesAdvanced.
  const loose = {};
  for (const [key, value] of Object.entries(preferences)) {
    if (isObject(value)) parts.push(...add(`## ${humanize(key.replace(/^preferences(?=[A-Z])/, ''), TITLE)}`, value));
    else loose[key] = value;
  }
  parts.push(...add('## Other preferences', loose));

  const quicklinks = new Map(list(ctx.lookup('builtin_package_quicklinks')?.quicklinks).filter(q => q?.uuid).map(q => [q.uuid, q.name]));
  const items = list(ctx.lookup('builtin_package_rootSearch')?.rootSearch).filter(isObject);
  const hotkeys = items.filter(i => typeof i.hotkey === 'string' && i.hotkey).map(i => [classicItemName(i, quicklinks), formatClassicHotkey(i.hotkey)]).sort(byFirst);
  if (hotkeys.length) parts.push('## Hotkeys', table(['Command', 'Hotkey'], hotkeys));
  const aliases = items.filter(i => typeof i.alias === 'string' && i.alias).map(i => [classicItemName(i, quicklinks), codeSpan(i.alias)]).sort(byFirst);
  if (aliases.length) parts.push('## Aliases', table(['Command', 'Alias'], aliases));
  count += hotkeys.length + aliases.length;

  const extensions = list(ctx.lookup('builtin_package_raycastExtensions')?.extensions).filter(isObject);
  if (extensions.length) {
    const title = e => e.title ?? humanize(e.name ?? 'unknown', TITLE);
    parts.push('## Extensions', table(['Extension', 'Author', 'Commands on'], extensions.map(e => {
      const all = list(e.commands);
      return [title(e), e.owner ?? '', `${all.filter(c => c?.enabled !== false).length} of ${all.length}`];
    }).sort(byFirst)));
    const prefs = (owner, items) => list(items).filter(p => isObject(p) && p.value !== undefined).map(p =>
      [owner, humanize(p.name ?? ''), p.type === 'password' || SECRET.test(p.name ?? '') ? HIDDEN : shortValue(p.value) ?? 'see the JSON']);
    const rows = extensions.flatMap(e => [
      ...prefs(title(e), e.prefs),
      ...list(e.commands).flatMap(c => prefs(`${title(e)} › ${humanize(c?.name ?? '', TITLE)}`, c?.prefs)),
    ]).sort(byFirst);
    if (rows.length) parts.push('### Extension preferences', table(['Extension', 'Setting', 'Value'], rows));
    count += rows.length;
  }

  for (const key of ctx.categories) {
    if (CLASSIC_OTHER_CATEGORIES.has(key) || !CLASSIC_PREFIX.test(key) || ctx.size(key) > MAX_SETTINGS_BYTES) continue;
    const data = ctx.lookup(key);
    if (isObject(data)) parts.push(...add(`## ${humanize(key.replace(CLASSIC_PREFIX, ''), TITLE)}`, data));
  }

  if (!count) return [];
  out.write('settings.md', join(parts));
  return [{ count, label: 'settings', path: 'settings.md' }];
}

// ---------------------------------------------------------------- AI memory

/** Pushes Markdown headings down, so remembered text nests under this file's own headings. */
function demoteHeadings(markdown, levels) {
  let fenced = false;
  return markdown.split('\n').map(line => {
    if (/^\s{0,3}(```|~~~)/.test(line)) fenced = !fenced;
    return fenced ? line : line.replace(/^#{1,6}(?=\s)/, hashes => '#'.repeat(Math.min(6, hashes.length + levels)));
  }).join('\n');
}

/**
 * What Raycast AI remembers: the general memory, kept with the AI extension's settings, and
 * one memory per chat folder (a project), kept with the chats.
 */
export function writeMemory(settings, out, ctx) {
  const memories = [];
  const ai = list(settings.internalExtensions).map(e => e?.meta).find(meta => isObject(meta) && typeof meta.aiMemory === 'string');
  if (ai?.aiMemory.trim()) memories.push({ title: 'General memory', text: ai.aiMemory, updated: ai.aiMemoryLastUpdated, enabled: ai.aiMemoryEnabled });
  for (const folder of list(ctx.lookupMember('ai', 'folders'))) {
    if (typeof folder?.memory !== 'string' || !folder.memory.trim()) continue;
    memories.push({ title: `Project memory: ${folder.name ?? folder.id}`, text: folder.memory, updated: folder.memoryLastUpdatedAt, enabled: folder.memoryEnabled });
  }
  if (!memories.length) return [];

  const parts = ['# AI memory', '_What Raycast AI has remembered from your chats, as it stood when the export was made._'];
  for (const memory of memories) {
    const meta = [memory.updated ? `Last updated ${timestamp(memory.updated)}` : '', memory.enabled === false ? 'memory is turned off' : ''].filter(Boolean);
    parts.push(`## ${memory.title}`);
    if (meta.length) parts.push(`_${meta.join(' · ')}_`);
    parts.push(demoteHeadings(memory.text.trim(), 2));
  }
  const latest = memories.map(m => toDate(m.updated)).filter(Boolean).sort((a, b) => b - a)[0];
  out.write('ai-memory.md', join(parts), { modified: latest });
  return [{ count: memories.length, label: 'AI memories', path: 'ai-memory.md' }];
}
