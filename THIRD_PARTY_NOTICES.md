# Third-party notices and attribution

## Upstream projects

AnkiCode started from [krmanik/Anki-NeetCode](https://github.com/krmanik/Anki-NeetCode)
by Mani (krmanik). That project builds on
[Peng-YM/LeetCode-Anki](https://github.com/Peng-YM/LeetCode-Anki) and
[krmanik/pycodeditor](https://github.com/krmanik/pycodeditor), both licensed
GPL-3.0. Their authors keep the copyright in their contributions. AnkiCode keeps
the note field layout of Anki-NeetCode so existing decks stay compatible. The
card templates, editor integration, workers and test generator were rewritten
for AnkiCode.

## Bundled components

| Component | Where | License | Notice |
| --- | --- | --- | --- |
| CodeMirror 6, Lezer, `@uiw/codemirror-theme-github` and their dependencies | `card-template/js/_codemirror6.js`, `_javascript-editor.js` | MIT | [`card-template/editor/_cm6-LICENSES.txt`](card-template/editor/_cm6-LICENSES.txt), generated from `package-lock.json`; exact versions are in that file |
| `@babel/runtime` helpers (pulled in by the theme package) | same bundles | MIT | same file |
| highlight.js 11.11.1, Python grammar and Atom One Dark theme | `card-template/js/_highlight.min.js`, `_python.min.js`, `card-template/css/_atom-one-dark.min.css` | BSD-3-Clause | [`LICENSES/highlightjs-BSD-3-Clause.txt`](LICENSES/highlightjs-BSD-3-Clause.txt) |
| KaTeX stylesheet (version not recorded in the file) | `card-template/css/_katex.css` | MIT | [`LICENSES/KaTeX-MIT.txt`](LICENSES/KaTeX-MIT.txt) |
| anki-persistence, Copyright (c) 2018 Simon Lammer. Its code isn't bundled. The draft storage keys stay compatible with it. | `card-template/shared/browser.mjs` | MIT | [`LICENSES/anki-persistence-MIT.txt`](LICENSES/anki-persistence-MIT.txt) |

The JavaScript card ships copies of the CSS files and the editor notices under
`_javascript-*` names, so each note type can be updated on its own in Anki.

## Loaded or installed separately

| Component | How it is used | License |
| --- | --- | --- |
| [Pyodide](https://pyodide.org/) 0.29.0 | Downloaded from jsDelivr by the Python card on first Run; not part of this repository | MPL-2.0 ([license](https://github.com/pyodide/pyodide/blob/0.29.0/LICENSE)) |
| [genanki](https://github.com/kerrickstaley/genanki) and its dependencies | Installed by uv from `uv.lock` to build decks; not bundled into cards | MIT |
| Rollup and its plugins | Build tools for the bundles; not shipped | MIT |

## AnkiCode itself

AnkiCode is Copyright (C) 2026 ronketer and licensed under [GPL-3.0](LICENSE). The original demo exercise in
`examples/cards.json` is also available under the [MIT license](examples/LICENSE).
The built demo deck carries these notices as media files. AnkiCode contains no
LeetCode or NeetCode problem statements and is not affiliated with them.
