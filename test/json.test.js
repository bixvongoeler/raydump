import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTopLevel, prettyPrint } from '../src/json.js';

const pretty = input => {
  const chunks = [];
  prettyPrint(Buffer.from(input), chunk => chunks.push(Buffer.from(chunk))); // chunks are reused, so copy
  return Buffer.concat(chunks).toString('utf8');
};
const split = input => splitTopLevel(Buffer.from(input)).map(({ key, value }) => [key, value.toString('utf8')]);

const tricky = {
  'key with "quotes" and \\ backslash': 'value with } ] , : and "quotes"',
  endsWithBackslash: 'C:\\',
  unicode: 'héllo 🎉 \u2028 日本語',
  escapes: 'line\nbreak\ttab\u0000nul',
  number: -12.5e-3,
  bool: true,
  nothing: null,
  emptyObject: {},
  emptyArray: [],
  nested: { a: [1, [2, [3, {}]], { b: [] }], c: { d: { e: 'f' } } },
  array: ['a', 1, false, null, { x: 1 }],
};

test('splitTopLevel returns each member with its exact source text', () => {
  const parts = split(JSON.stringify(tricky));
  assert.deepEqual(parts.map(([key]) => key), Object.keys(tricky));
  for (const [key, value] of parts) assert.deepEqual(JSON.parse(value), tricky[key]);
});

test('splitTopLevel handles whitespace, a BOM and an empty object', () => {
  assert.deepEqual(split('\ufeff {\n  "a" : 1 ,\r\n\t"b" : [ 1 , 2 ]\n}\n'), [['a', '1'], ['b', '[ 1 , 2 ]']]);
  assert.deepEqual(split(' { } '), []);
});

test('splitTopLevel rejects input that is not a complete object', () => {
  for (const bad of ['[1,2]', '"text"', '', '{"a":1', '{"a":{"b":1}', '{"a":"unterminated', '{"a" 1}', '{"a":}', '{a:1}', '{"a":1 "b":2}']) {
    assert.throws(() => split(bad), SyntaxError, bad);
  }
});

test('prettyPrint matches JSON.stringify with two-space indentation', () => {
  const values = [tricky, [], {}, [[]], [{}], { a: [] }, 'text', 42, null, [1, 2, 3], { a: { b: { c: [{ d: [] }] } } }];
  for (const value of values) {
    assert.equal(pretty(JSON.stringify(value)), JSON.stringify(value, null, 2) + '\n');
  }
});

test('prettyPrint normalises existing whitespace', () => {
  assert.equal(pretty(JSON.stringify(tricky, null, '\t')), JSON.stringify(tricky, null, 2) + '\n');
  assert.equal(pretty('{ }'), '{}\n');
  assert.equal(pretty('[\n]'), '[]\n');
});

test('prettyPrint copies numbers and escapes exactly as written', () => {
  // JSON.parse would round the first number and rewrite the others.
  assert.equal(
    pretty('{"big":12345678901234567890,"float":1.0,"exp":1E5,"escaped":"\\u00e9\\/"}'),
    '{\n  "big": 12345678901234567890,\n  "float": 1.0,\n  "exp": 1E5,\n  "escaped": "\\u00e9\\/"\n}\n',
  );
});

test('prettyPrint handles output larger than its internal buffer', () => {
  const big = {
    numbers: Array.from({ length: 300_000 }, (_, i) => i),
    blob: 'x'.repeat(3 * 1024 * 1024), // one string larger than the buffer
    after: ['still', 'correct'],
  };
  assert.equal(pretty(JSON.stringify(big)), JSON.stringify(big, null, 2) + '\n');
});
