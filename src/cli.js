import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { inspectExport, decryptExport, ExportError, PasswordError } from './container.js';
import { splitTopLevel, prettyPrint } from './json.js';
import { OutputDir } from './output.js';
import { safeName } from './markdown.js';
import { SECTIONS } from './writers.js';

const NAME = 'raydump';
const SECTION_NAMES = ['json', ...new Set(SECTIONS.map(s => s.name))];
const PASSWORD_ENV = 'RAYCAST_EXPORT_PASSWORD';
const PASSWORD_ATTEMPTS = 3;

const HELP = `Usage: ${NAME} <export.rayconfig> [options]

Decrypts a Raycast export with its password and writes the contents as
Markdown and JSON files you can read, search and keep.

Options:
  -o, --output <dir>    Where to write (default: a folder named after the export)
  -p, --password <pw>   Export password. If omitted, $${PASSWORD_ENV} is used,
                        otherwise you are asked for it
      --only <list>     Write only these sections (comma-separated)
      --skip <list>     Write everything except these sections
      --raw <file>      Write just the decrypted JSON, unchanged, to <file>
                        ("-" for standard output) and nothing else
  -f, --force           Write into an output folder that already has files in it
  -q, --quiet           Do not print the summary
  -h, --help            Show this help
  -v, --version         Show the version

Sections: ${SECTION_NAMES.join(', ')}
`;

const OPTIONS = {
  output: { type: 'string', short: 'o' },
  password: { type: 'string', short: 'p' },
  only: { type: 'string' },
  skip: { type: 'string' },
  raw: { type: 'string' },
  force: { type: 'boolean', short: 'f' },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

class UsageError extends Error {}

function version() {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}

function selectSections({ only, skip }) {
  const parse = (value, flag) => {
    const names = value.split(',').map(s => s.trim()).filter(Boolean);
    const unknown = names.filter(n => !SECTION_NAMES.includes(n));
    if (unknown.length) throw new UsageError(`Unknown section for ${flag}: ${unknown.join(', ')} (choose from ${SECTION_NAMES.join(', ')})`);
    return names;
  };
  if (only !== undefined && skip !== undefined) throw new UsageError('Use either --only or --skip, not both');
  if (only !== undefined) return new Set(parse(only, '--only'));
  const skipped = skip === undefined ? [] : parse(skip, '--skip');
  return new Set(SECTION_NAMES.filter(n => !skipped.includes(n)));
}

/** Asks for a password on the terminal without echoing it. */
function promptPassword(question) {
  const { stdin, stderr } = process;
  return new Promise((resolvePrompt, reject) => {
    let value = '';
    const finish = (settle, result) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write('\n');
      settle(result);
    };
    const onData = chunk => {
      if (chunk.length > 1 && chunk.startsWith('\x1b')) return; // arrow keys and other escape sequences
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\x04') return finish(resolvePrompt, value);
        if (ch === '\x03') return finish(reject, new ExportError('Cancelled'));
        if (ch === '\x7f' || ch === '\b') value = Array.from(value).slice(0, -1).join('');
        else if (ch >= ' ') value += ch;
      }
    };
    // Raw mode first: once the prompt is visible, nothing typed may be echoed.
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdin.resume();
    stderr.write(question);
  });
}

/** Decrypts with the given password, or asks for one (with a few retries) on a terminal. */
async function decrypt(file, info, givenPassword) {
  if (!info.encrypted || givenPassword) return decryptExport(file, info, givenPassword);
  if (!process.stdin.isTTY) {
    throw new ExportError(`This export is encrypted. Pass --password, or set $${PASSWORD_ENV}.`);
  }
  for (let attempt = 1; ; attempt++) {
    const password = await promptPassword('Export password: ');
    try {
      return decryptExport(file, info, password);
    } catch (error) {
      if (!(error instanceof PasswordError) || attempt === PASSWORD_ATTEMPTS) throw error;
      process.stderr.write('That password did not work. Try again.\n');
    }
  }
}

function defaultOutputDir(inputPath) {
  const name = basename(inputPath).replace(/\.rayconfig$/i, '');
  return name === basename(inputPath) ? `${name}-extracted` : name;
}

function extract(json, info, outDir, sections, warn) {
  let members;
  try {
    members = splitTopLevel(json);
  } catch (cause) {
    throw new ExportError('The decrypted export is not in the expected format', { cause });
  }

  const out = new OutputDir(outDir);
  const rows = [];
  const { encryption, ...header } = info.header;
  if (sections.has('json') && Object.keys(header).length) out.write('json/_export-header.json', JSON.stringify(header, null, 2) + '\n');

  // What a writer may look at besides its own category. Lookups give undefined rather than fail.
  const raw = new Map(members.map(m => [m.key, m.value]));
  const parse = buf => {
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      return undefined;
    }
  };
  const context = {
    header,
    sections,
    categories: [...raw.keys()],
    size: key => raw.get(key)?.length ?? 0,
    lookup: key => (raw.has(key) ? parse(raw.get(key)) : undefined),
    // One member of a category without parsing the rest of it; the AI category can be very large.
    lookupMember(key, member) {
      try {
        const found = splitTopLevel(raw.get(key)).find(m => m.key === member);
        return found && parse(found.value);
      } catch {
        return undefined;
      }
    },
  };

  let jsonFiles = 0;
  for (const { key, value } of members) {
    if (sections.has('json')) {
      out.stream(`json/${safeName(key)}.json`, sink => prettyPrint(value, sink));
      jsonFiles++;
    }
    const writers = SECTIONS.filter(s => s.category === key && sections.has(s.name));
    if (!writers.length) continue;

    let data;
    try {
      data = JSON.parse(value.toString('utf8'));
    } catch (error) {
      // Most likely a category too large for one JavaScript string; its JSON file is still complete.
      warn(`Could not read "${key}" to write ${writers.map(w => w.name).join(', ')} as Markdown (${error.message})`);
      continue;
    }
    if (data === null || typeof data !== 'object') continue;
    for (const section of writers) {
      try {
        rows.push(...section.write(data, out, context));
      } catch (error) {
        warn(`Could not write ${section.name} (${error.message})`);
      }
    }
  }
  if (jsonFiles) rows.unshift({ count: jsonFiles, label: 'categories as JSON', path: 'json/' });
  return rows;
}

function printSummary(info, outDir, rows) {
  const { appVersion, exportedAt } = info.header;
  const source = info.format === 'classic' ? 'Raycast 1.x export' : `Raycast${appVersion ? ` ${appVersion}` : ''} export${exportedAt ? ` from ${exportedAt}` : ''}`;
  const lines = [`${source} -> ${outDir}`, ''];
  const width = Math.max(...rows.map(r => r.label.length));
  for (const r of rows) lines.push(`  ${String(r.count).padStart(6)}  ${r.label.padEnd(width)}  ${r.path}`);
  lines.push('', 'These files are not encrypted and can include private data such as clipboard history and AI chats.');
  process.stdout.write(lines.join('\n') + '\n');
}

/**
 * Runs the command line tool.
 * @param {string[]} argv arguments after the program name
 * @returns {Promise<number>} the process exit code
 */
export async function main(argv) {
  let failed = false;
  const warn = message => {
    failed = true;
    process.stderr.write(`Warning: ${message}\n`);
  };

  try {
    let parsed;
    try {
      parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
    } catch (error) {
      throw new UsageError(error.message);
    }
    const { values: opts, positionals } = parsed;
    if (opts.help) return process.stdout.write(HELP), 0;
    if (opts.version) return process.stdout.write(`${version()}\n`), 0;
    if (positionals.length !== 1) throw new UsageError(positionals.length ? 'Expected exactly one export file' : 'No export file given');
    const sections = selectSections(opts);

    const inputPath = positionals[0];
    let file;
    try {
      file = readFileSync(inputPath);
    } catch (error) {
      throw new ExportError(`Cannot read ${inputPath} (${error.code ?? error.message})`);
    }

    const info = inspectExport(file);
    const json = await decrypt(file, info, opts.password ?? process.env[PASSWORD_ENV]);

    if (opts.raw !== undefined) {
      if (opts.raw === '-') process.stdout.write(json);
      else writeFileSync(opts.raw, json);
      return 0;
    }

    const outDir = opts.output ?? defaultOutputDir(inputPath);
    if (existsSync(outDir)) {
      if (!statSync(outDir).isDirectory()) throw new ExportError(`${outDir} exists and is not a folder`);
      if (readdirSync(outDir).length && !opts.force) {
        throw new ExportError(`${outDir} already has files in it. Choose another folder with --output, or pass --force to write into it.`);
      }
    }

    const rows = extract(json, info, outDir, sections, warn);
    if (!opts.quiet) printSummary(info, resolve(outDir), rows);
    return failed ? 1 : 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${HELP}`);
      return 2;
    }
    if (error instanceof ExportError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
