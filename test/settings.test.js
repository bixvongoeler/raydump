import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanize, formatHotkey, formatClassicHotkey } from '../src/settings.js';

test('humanize turns setting keys into words', () => {
  assert.equal(humanize('openAtLogin'), 'Open at login');
  assert.equal(humanize('aiChatAskQuestionsEnabled'), 'AI chat ask questions enabled');
  assert.equal(humanize('raycastUI_preferredTextSize'), 'Raycast UI preferred text size');
  assert.equal(humanize('contentSearchOcrMaxPages'), 'Content search OCR max pages');
  assert.equal(humanize('aiByokApiKeys'), 'AI BYOK API keys');
  assert.equal(humanize('window-management', { title: true }), 'Window Management');
  assert.equal(humanize('openQuickAi', { title: true }), 'Open Quick AI');
  assert.equal(humanize('layoutGroup', { capital: false }), 'layout group');
  assert.equal(humanize('aiCommand', { capital: false }), 'AI command');
});

const single = (modifiers, code) => ({ kind: { type: 'SingleStep', shortcut: { modifiers: modifiers.map(modifier => ({ modifier })), key: { type: 'LayoutIndependent', code } } } });

test('formatHotkey shows Raycast 2.x hotkeys the way macOS writes them', () => {
  assert.equal(formatHotkey(single(['Meta'], 49)), '⌘ Space');
  assert.equal(formatHotkey(single(['Meta', 'Shift', 'Alt', 'Ctrl'], 17)), '⌃⌥⇧⌘ T'); // in the system's order, whatever the export's
  assert.equal(formatHotkey(single([], 122)), 'F1');
  assert.equal(formatHotkey(single(['Alt'], 999)), '⌥ key code 999');
  assert.equal(formatHotkey({ kind: { type: 'SingleKey', shortcut: { type: 'Modifiers', modifiers: [{ modifier: 'Shift' }, { modifier: 'Meta' }] } } }), '⇧⌘ alone');
  assert.equal(formatHotkey({ kind: { type: 'DoubleTap', shortcut: { modifier: { modifier: 'Meta', directionality: 'right' } } } }), 'double-tap right ⌘');
  assert.equal(formatHotkey({ kind: { type: 'Future', shortcut: {} } }), '`{"type":"Future","shortcut":{}}`');
});

test('formatHotkey does not guess key names on other systems', () => {
  assert.equal(formatHotkey(single(['Ctrl', 'Meta'], 49), false), 'Ctrl+Win+key code 49');
});

test('formatClassicHotkey reads Raycast 1.x hotkeys', () => {
  assert.equal(formatClassicHotkey('Command-49'), '⌘ Space');
  assert.equal(formatClassicHotkey('Shift-Control-Option-Command-45'), '⌃⌥⇧⌘ N');
  assert.equal(formatClassicHotkey('Option-Command-125'), '⌥⌘ ↓');
  assert.equal(formatClassicHotkey('something else'), '`something else`');
});
