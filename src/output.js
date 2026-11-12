import { mkdirSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';

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

  /** @param {string} relativePath @param {string | Buffer} content */
  write(relativePath, content) {
    writeFileSync(this.#resolve(relativePath), content);
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
