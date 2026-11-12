// Reads the .rayconfig formats Raycast itself can import and returns the decrypted,
// decompressed JSON bytes. Decrypting always needs the password the export was
// created with; nothing here guesses or bypasses it.
//
// raycfg3  Raycast 2.x, schema 3 (current):
//          "RAYCFG3\n" | uint32le headerLen | gzip(JSON header) | payload | 16-byte GCM tag
//          payload = AES-256-GCM(gzip(JSON)); key = scrypt(password, salt, 32) with
//          Node's default cost (N=16384, r=8, p=1); iv and salt are hex strings in
//          header.encryption. Unencrypted exports have no encryption block and no tag.
//
// wrapped  Raycast 2.x, schema 1 and 2:
//          gzip(JSON { schemaVersion, encryption?: { salt, iv, authTag }, data: hex })
//          data = AES-256-GCM(body) with the same scrypt key; body is the JSON text,
//          gzipped from schema 2 on.
//
// classic  Raycast 1.x:
//          iv (16 bytes) | AES-256-CBC(gzip(JSON)), key = SHA-256(password);
//          or plain gzip(JSON) when exported without a password.

import { scryptSync, createDecipheriv, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { splitTopLevel } from './json.js';

const MAGIC_PREFIX = Buffer.from('RAYCFG', 'ascii');
const MAGIC = Buffer.from('RAYCFG3\n', 'ascii');
const HEADER_OFFSET = MAGIC.length + 4;
const MAX_HEADER_LENGTH = 1 << 20;
const GCM_TAG_LENGTH = 16;
const CBC_IV_LENGTH = 16;

/** An error whose message is meant for the person running the tool. */
export class ExportError extends Error {
  name = 'ExportError';
}

/** The password was missing or did not decrypt the export. */
export class PasswordError extends ExportError {
  name = 'PasswordError';
}

const isGzip = buf => buf[0] === 0x1f && buf[1] === 0x8b;

function gunzip(buf, what) {
  try {
    return gunzipSync(buf);
  } catch (cause) {
    throw new ExportError(`The export file is damaged or incomplete (${what} could not be decompressed)`, { cause });
  }
}

function parseJson(buf, what) {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (cause) {
    throw new ExportError(`The export file is damaged or incomplete (${what} is not valid JSON)`, { cause });
  }
}

function gcmDecrypt(ciphertext, { salt, iv }, tag, password) {
  if (!password) throw new PasswordError('This export is encrypted; a password is required');
  if (typeof salt !== 'string' || typeof iv !== 'string') throw new ExportError('The export file is damaged (missing encryption parameters)');
  const key = scryptSync(password, Buffer.from(salt, 'hex'), 32);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]); // final() verifies the tag
  } catch (cause) {
    throw new PasswordError('Incorrect password (or the export file is damaged)', { cause });
  }
}

/**
 * Identifies the export format and whether a password is needed, without decrypting.
 * @param {Buffer} buf the whole .rayconfig file
 * @returns {{ format: 'raycfg3' | 'wrapped' | 'classic', encrypted: boolean, header: object }}
 *   plus private fields consumed by decryptExport
 */
export function inspectExport(buf) {
  if (buf.subarray(0, MAGIC_PREFIX.length).equals(MAGIC_PREFIX)) {
    if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
      const version = buf.toString('latin1', 0, MAGIC.length).trim();
      throw new ExportError(`Unsupported export container "${version}". This tool understands RAYCFG3; a newer Raycast may have changed the format.`);
    }
    if (buf.length < HEADER_OFFSET) throw new ExportError('The export file is damaged or incomplete (truncated header)');
    const headerLength = buf.readUInt32LE(MAGIC.length);
    const payloadStart = HEADER_OFFSET + headerLength;
    if (headerLength === 0 || headerLength > MAX_HEADER_LENGTH || payloadStart > buf.length) {
      throw new ExportError('The export file is damaged or incomplete (implausible header length)');
    }
    const header = parseJson(gunzip(buf.subarray(HEADER_OFFSET, payloadStart), 'header'), 'header');
    return { format: 'raycfg3', encrypted: Boolean(header.encryption), header, payloadStart };
  }

  if (isGzip(buf)) {
    const inner = gunzip(buf, 'file');
    let members;
    try {
      members = new Map(splitTopLevel(inner).map(m => [m.key, m.value]));
    } catch (cause) {
      throw new ExportError('This does not look like a Raycast export (unexpected content)', { cause });
    }
    if (members.has('data') && members.has('schemaVersion')) {
      const header = {};
      for (const [key, value] of members) if (key !== 'data') header[key] = parseJson(value, 'header');
      return { format: 'wrapped', encrypted: Boolean(header.encryption), header, data: members.get('data') };
    }
    return { format: 'classic', encrypted: false, header: {}, json: inner };
  }

  // Anything else can only be a password-protected Raycast 1.x export, which has no
  // recognisable header: it is ciphertext from the first byte.
  if (buf.length <= CBC_IV_LENGTH) throw new ExportError('This does not look like a Raycast export (file is too small)');
  return { format: 'classic', encrypted: true, header: {} };
}

/**
 * Decrypts and decompresses an export.
 * @param {Buffer} buf the whole .rayconfig file
 * @param {ReturnType<typeof inspectExport>} info
 * @param {string} [password]
 * @returns {Buffer} the export's JSON document as UTF-8 bytes
 */
export function decryptExport(buf, info, password) {
  switch (info.format) {
    case 'raycfg3': {
      let payload = buf.subarray(info.payloadStart);
      if (info.encrypted) {
        if (payload.length < GCM_TAG_LENGTH) throw new ExportError('The export file is damaged or incomplete (missing authentication tag)');
        const tagStart = payload.length - GCM_TAG_LENGTH;
        payload = gcmDecrypt(payload.subarray(0, tagStart), info.header.encryption, payload.subarray(tagStart), password);
      }
      if (!payload.length) throw new ExportError('The export file is damaged or incomplete (empty payload)');
      return gunzip(payload, 'payload');
    }

    case 'wrapped': {
      // `data` is a JSON string of hex digits; decode it straight from the bytes.
      let body = Buffer.from(info.data.toString('latin1', 1, info.data.length - 1), 'hex');
      if (info.encrypted) {
        const { authTag } = info.header.encryption;
        if (typeof authTag !== 'string') throw new ExportError('The export file is damaged (missing authentication tag)');
        body = gcmDecrypt(body, info.header.encryption, Buffer.from(authTag, 'hex'), password);
      }
      return info.header.schemaVersion >= 2 ? gunzip(body, 'payload') : body;
    }

    case 'classic': {
      if (!info.encrypted) return info.json;
      if (!password) throw new PasswordError('This export is encrypted; a password is required');
      const key = createHash('sha256').update(password).digest();
      let compressed;
      try {
        const decipher = createDecipheriv('aes-256-cbc', key, buf.subarray(0, CBC_IV_LENGTH));
        compressed = Buffer.concat([decipher.update(buf.subarray(CBC_IV_LENGTH)), decipher.final()]);
      } catch (cause) {
        throw new PasswordError('Incorrect password, or this is not a Raycast export', { cause });
      }
      // CBC has no integrity check, so a wrong password can also surface as garbage here.
      if (!isGzip(compressed)) throw new PasswordError('Incorrect password, or this is not a Raycast export');
      return gunzip(compressed, 'payload');
    }

    default:
      throw new ExportError(`Unknown export format: ${info.format}`);
  }
}
