// Byte-level JSON helpers.
//
// Exports can decompress to hundreds of megabytes, which is more than V8 will hold
// in one string, and JSON.parse would also round integers above 2^53. Working on the
// raw UTF-8 bytes avoids both: the export is split into its top-level categories and
// re-indented without ever being parsed as a whole. Every structural character in
// JSON is ASCII, so multi-byte UTF-8 sequences can be copied through untouched.

const QUOTE = 0x22, BACKSLASH = 0x5c, COMMA = 0x2c, COLON = 0x3a;
const LBRACE = 0x7b, RBRACE = 0x7d, LBRACKET = 0x5b, RBRACKET = 0x5d;

const isWs = c => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;

function skipWs(buf, i) {
  while (i < buf.length && isWs(buf[i])) i++;
  return i;
}

/** Index just past the string that starts at buf[i] === '"'. */
function skipString(buf, i) {
  for (i++; i < buf.length; i++) {
    const c = buf[i];
    if (c === BACKSLASH) i++;
    else if (c === QUOTE) return i + 1;
  }
  throw new SyntaxError('Unterminated string in JSON');
}

/** Index just past the JSON value that starts at buf[i]. */
function skipValue(buf, i) {
  const first = buf[i];
  if (first === QUOTE) return skipString(buf, i);
  if (first === LBRACE || first === LBRACKET) {
    let depth = 0;
    for (; i < buf.length; i++) {
      const c = buf[i];
      if (c === QUOTE) i = skipString(buf, i) - 1;
      else if (c === LBRACE || c === LBRACKET) depth++;
      else if ((c === RBRACE || c === RBRACKET) && --depth === 0) return i + 1;
    }
    throw new SyntaxError('Unterminated object or array in JSON');
  }
  while (i < buf.length && !isWs(buf[i]) && buf[i] !== COMMA && buf[i] !== RBRACE && buf[i] !== RBRACKET) i++;
  return i;
}

/**
 * Splits a JSON object into its top-level members without parsing the values.
 * @param {Buffer} buf UTF-8 JSON text whose root is an object
 * @returns {{ key: string, value: Buffer }[]} values are views into `buf`
 */
export function splitTopLevel(buf) {
  let i = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0; // UTF-8 BOM
  i = skipWs(buf, i);
  if (buf[i] !== LBRACE) throw new SyntaxError('Expected a JSON object');
  const entries = [];
  i = skipWs(buf, i + 1);
  if (buf[i] === RBRACE) return entries;
  for (;;) {
    if (buf[i] !== QUOTE) throw new SyntaxError('Expected a property name in JSON');
    const keyEnd = skipString(buf, i);
    const key = JSON.parse(buf.toString('utf8', i, keyEnd));
    i = skipWs(buf, keyEnd);
    if (buf[i] !== COLON) throw new SyntaxError('Expected ":" in JSON');
    const start = skipWs(buf, i + 1);
    const end = skipValue(buf, start);
    if (end === start) throw new SyntaxError('Expected a value in JSON');
    entries.push({ key, value: buf.subarray(start, end) });
    i = skipWs(buf, end);
    if (buf[i] === RBRACE) return entries;
    if (buf[i] !== COMMA) throw new SyntaxError('Expected "," or "}" in JSON');
    i = skipWs(buf, i + 1);
  }
}

/**
 * Re-indents JSON with two spaces, like JSON.stringify(value, null, 2), but straight
 * from the bytes: numbers and string escapes are copied exactly as they were written.
 * @param {Buffer} buf UTF-8 JSON text
 * @param {(chunk: Buffer) => void} sink called synchronously; a chunk is only valid during the call
 */
export function prettyPrint(buf, sink) {
  const out = Buffer.allocUnsafe(1 << 20);
  let pos = 0, depth = 0;
  const flush = () => { if (pos) { sink(out.subarray(0, pos)); pos = 0; } };
  const put = c => { if (pos === out.length) flush(); out[pos++] = c; };
  const newline = () => { put(0x0a); for (let n = depth * 2; n > 0; n--) put(0x20); };
  const copy = (from, to) => {
    if (to - from > out.length - pos) flush();
    if (to - from > out.length) sink(buf.subarray(from, to));
    else pos += buf.copy(out, pos, from, to);
  };

  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c === QUOTE) {
      const end = skipString(buf, i);
      copy(i, end);
      i = end - 1;
    } else if (c === LBRACE || c === LBRACKET) {
      const next = skipWs(buf, i + 1);
      put(c);
      if (buf[next] === c + 2) { put(c + 2); i = next; } // "{}" or "[]" stay on one line
      else { depth++; newline(); }
    } else if (c === RBRACE || c === RBRACKET) {
      depth = Math.max(0, depth - 1);
      newline();
      put(c);
    } else if (c === COMMA) {
      put(c);
      newline();
    } else if (c === COLON) {
      put(c);
      put(0x20);
    } else if (!isWs(c)) {
      put(c);
    }
  }
  put(0x0a);
  flush();
}
