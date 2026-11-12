# raydump

Turn a Raycast export into files you can read.

Raycast's **Export Settings & Data** command saves everything into one `.rayconfig` file that only Raycast can open. `raydump` decrypts that file with the password you chose and writes your notes, AI chats, snippets, quicklinks, clipboard history and settings as Markdown and JSON.

- It needs your export password. It does not bypass or weaken the encryption.
- It runs entirely on your computer and makes no network requests.
- It has no dependencies beyond Node.js.

## Quick start

```sh
npx raydump "Raycast 2026-11-12.rayconfig"
```

You are asked for the export password, and the result is written to a folder named after the export. This needs [Node.js](https://nodejs.org) 20 or later.

## Install

If you export regularly, install it with Homebrew:

```sh
brew install bixvongoeler/tap/raydump
raydump "Raycast 2026-11-12.rayconfig"
```

Or with npm:

```sh
npm install -g raydump
```

## What you get

```
Raycast 2026-11-12/
├── notes/                 one Markdown file per note
│   └── images/            images used in notes
├── ai-chats/
│   ├── chat/              one Markdown file per AI chat, named by date and title
│   └── quick_ai/          Quick AI conversations
├── snippets.md
├── quicklinks.md
├── transcriptions.md      dictation history
├── clipboard.md           clipboard history, newest first
├── clipboard-files/       images and PDFs from the clipboard history
└── json/                  every category of the export as formatted JSON
```

The `json/` folder is the complete export: settings, extensions, window layouts, themes, usage history and everything else, including the data behind the Markdown files. The Markdown files are a readable view of the parts people usually want to read.

AI chats include reasoning and tool calls in collapsible sections. Notes keep their headings, lists, checkboxes, code blocks, links and images.

## Usage

```
raydump <export.rayconfig> [options]

  -o, --output <dir>    Where to write (default: a folder named after the export)
  -p, --password <pw>   Export password
      --only <list>     Write only these sections (comma-separated)
      --skip <list>     Write everything except these sections
      --raw <file>      Write just the decrypted JSON, unchanged, to <file>
                        ("-" for standard output) and nothing else
  -f, --force           Write into an output folder that already has files in it
  -q, --quiet           Do not print the summary
  -h, --help            Show help
  -v, --version         Show the version

Sections: json, notes, chats, transcriptions, snippets, quicklinks, clipboard
```

Examples:

```sh
raydump export.rayconfig -o ~/Documents/raycast-backup
raydump export.rayconfig --only notes,snippets
raydump export.rayconfig --skip clipboard
raydump export.rayconfig --raw - | jq '.snippets'
```

### Password

The password is taken from the first of these that is set:

1. `--password`. Note that this leaves the password in your shell history.
2. The `RAYCAST_EXPORT_PASSWORD` environment variable.
3. A prompt, which does not show what you type.

Exports made without a password need none.

## Supported exports

| Export from | Decrypts | JSON | Markdown |
|---|---|---|---|
| Raycast 2.x (current format) | yes | yes | yes |
| Raycast 2.x (earlier format) | yes | yes | yes |
| Raycast 1.x | yes | yes | no |

The current Raycast 2.x format is verified against real exports. The earlier 2.x format and the 1.x format are implemented from how Raycast imports them and are tested with generated files only. If one of yours does not work, please [open an issue](https://github.com/bixvongoeler/raycast-export-extractor/issues).

## Privacy

The output is not encrypted. It can contain anything you have copied, dictated or typed into Raycast, including passwords and tokens in your clipboard history. Keep the folder somewhere private, and out of shared or synced locations unless you intend that.

`--skip clipboard` leaves the clipboard history out of the Markdown, but `json/clipboardHistory.json` still contains it. To leave it out completely, name what you do want, for example `--only notes,chats,snippets,quicklinks`.

## Limitations

- Raycast 1.x exports are written as JSON only.
- Most images and files in the clipboard history are not inside the export. Raycast stores them in its own data folder and the export only records their paths. `clipboard.md` lists those paths; the files are still on the computer that made the export.
- The export format is not documented by Raycast and may change. `raydump` reports an unknown format instead of guessing.

## How it works

A current `.rayconfig` file is laid out like this:

```
"RAYCFG3\n" | header length (uint32, little-endian) | gzip(JSON header) | payload | 16-byte tag
```

The header holds the export date, app version and, for encrypted exports, a random salt and IV. The payload is gzipped JSON encrypted with AES-256-GCM. The key is derived from your password with scrypt (N=16384, r=8, p=1), and the trailing tag authenticates the data, so a wrong password or a damaged file is detected instead of producing garbage.

The older formats are described at the top of [`src/container.js`](src/container.js).

## Development

```sh
git clone https://github.com/bixvongoeler/raycast-export-extractor.git
cd raycast-export-extractor
npm test
```

There is nothing to install or build. The tests use generated exports only; never commit a real `.rayconfig` file or anything extracted from one.

## Disclaimer

This project is not affiliated with or endorsed by Raycast. Raycast is a trademark of its owner.

## License

[MIT](LICENSE)
