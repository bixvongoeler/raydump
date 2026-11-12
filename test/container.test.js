import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { inspectExport, decryptExport, ExportError, PasswordError } from '../src/container.js';
import { encodeRaycfg3, encodeWrapped, encodeClassic } from './helpers.js';

const data = { notes: { notes: [{ title: 'héllo "wörld" 🎉' }] }, settings: { n: 1 } };
const json = JSON.stringify(data);
const read = (file, password) => decryptExport(file, inspectExport(file), password).toString('utf8');

const formats = [
  { name: 'raycfg3', format: 'raycfg3', encode: (d, o) => encodeRaycfg3(d, o) },
  { name: 'wrapped schema 2', format: 'wrapped', encode: (d, o) => encodeWrapped(d, { ...o, schemaVersion: 2 }) },
  { name: 'wrapped schema 1', format: 'wrapped', encode: (d, o) => encodeWrapped(d, { ...o, schemaVersion: 1 }) },
  { name: 'classic', format: 'classic', encode: (d, o) => encodeClassic(d, o) },
];

for (const { name, format, encode } of formats) {
  test(`${name}: reads an encrypted export`, () => {
    const file = encode(data, { password: 'pass wörd' });
    const info = inspectExport(file);
    assert.equal(info.format, format);
    assert.equal(info.encrypted, true);
    assert.equal(decryptExport(file, info, 'pass wörd').toString('utf8'), json);
  });

  test(`${name}: reads an unencrypted export without a password`, () => {
    const file = encode(data);
    const info = inspectExport(file);
    assert.equal(info.format, format);
    assert.equal(info.encrypted, false);
    assert.equal(decryptExport(file, info).toString('utf8'), json);
  });

  test(`${name}: rejects a wrong password`, () => {
    const file = encode(data, { password: 'right' });
    assert.throws(() => read(file, 'wrong'), PasswordError);
  });

  test(`${name}: requires a password when encrypted`, () => {
    const file = encode(data, { password: 'right' });
    assert.throws(() => read(file), PasswordError);
    assert.throws(() => read(file, ''), PasswordError);
  });
}

test('raycfg3: exposes the header', () => {
  const info = inspectExport(encodeRaycfg3(data, { password: 'x', header: { appVersion: '9.9.9' } }));
  assert.equal(info.header.appVersion, '9.9.9');
  assert.equal(info.header.schemaVersion, 3);
  assert.match(info.header.encryption.salt, /^[0-9a-f]{32}$/);
});

test('raycfg3: detects tampering with the ciphertext', () => {
  const file = encodeRaycfg3(data, { password: 'right' });
  file[file.length - 20] ^= 0xff;
  assert.throws(() => read(file, 'right'), PasswordError);
});

test('raycfg3: reports a truncated file', () => {
  const file = encodeRaycfg3(data, { password: 'right' });
  assert.throws(() => read(file.subarray(0, file.length - 5), 'right'), ExportError);
  assert.throws(() => inspectExport(file.subarray(0, 10)), ExportError);
});

test('raycfg3: reports an implausible header length', () => {
  const file = encodeRaycfg3(data);
  file.writeUInt32LE(0xffffffff, 8);
  assert.throws(() => inspectExport(file), /implausible header length/);
});

test('raycfg3: reports an empty payload', () => {
  const file = encodeRaycfg3(data);
  const headerEnd = 12 + file.readUInt32LE(8);
  assert.throws(() => read(file.subarray(0, headerEnd)), /empty payload/);
});

test('rejects a newer container version by name', () => {
  const file = encodeRaycfg3(data);
  file[6] = '4'.charCodeAt(0);
  assert.throws(() => inspectExport(file), /Unsupported export container "RAYCFG4"/);
});

test('rejects gzip files that are not an export', () => {
  assert.throws(() => inspectExport(gzipSync('[1,2,3]')), ExportError);
  assert.throws(() => inspectExport(gzipSync('not json')), ExportError);
});

test('rejects tiny files', () => {
  assert.throws(() => inspectExport(Buffer.from('hello')), ExportError);
});

test('classic: random data fails as a password error, not a crash', () => {
  const file = Buffer.alloc(4096, 7);
  const info = inspectExport(file);
  assert.equal(info.format, 'classic');
  assert.throws(() => decryptExport(file, info, 'anything'), PasswordError);
});
