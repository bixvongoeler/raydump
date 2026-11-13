import { mkdirSync, writeFileSync, openSync, writeSync, closeSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';

function stamp(path, { created, modified = created }) {
  try {
    // macOS moves a file's creation date back when it is dated earlier than that, so dating
    // it to `created` first gives both dates there. Elsewhere only the modified date changes.
    if (created) utimesSync(path, created, created);
    if (modified) utimesSync(path, modified, modified);
  } catch {
    // The dates are a convenience; a file system that refuses them still has the file.
  }
}

/**
 * Writes files below one root directory. Paths are given with forward slashes
 * (the same form used in Markdown links) on every platform. Directories are
 * created owner-only where the platform supports it, since the extracted data
 * is private.
 */
export class OutputDir {
  #dirs = new Set();

  constructor(root) {
    this.root = root;
  }

  #resolve(relativePath) {
    const path = join(this.root, ...relativePath.split('/'));
    const dir = dirname(path);
    if (!this.#dirs.has(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      this.#dirs.add(dir);
    }
    return path;
  }

  /**
   * @param {string} relativePath
   * @param {string | Buffer} content
   * @param {{ created?: Date, modified?: Date }} [dates] when the content was made and last changed.
   *   The file is dated to match, so notes and chats sort by their real age in a file manager.
   */
  write(relativePath, content, dates) {
    const path = this.#resolve(relativePath);
    writeFileSync(path, content);
    if (dates) stamp(path, dates);
  }

  /**
   * Writes a file piece by piece.
   * @param {string} relativePath
   * @param {(sink: (chunk: Buffer) => void) => void} produce
   */
  stream(relativePath, produce) {
    const fd = openSync(this.#resolve(relativePath), 'w');
    try {
      produce(chunk => {
        for (let offset = 0; offset < chunk.length;) offset += writeSync(fd, chunk, offset, chunk.length - offset);
      });
    } finally {
      closeSync(fd);
    }
  }
}
