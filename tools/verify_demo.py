"""Check the built demo deck: note identities, fields, media and the preview pages.

Run after build_demo.py. Writes build/demo-audit-results.json."""
import html
import json
from pathlib import Path
import re
import sqlite3
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from ankicode.apkg import read_package
from build_demo import FIELDS as fields
import genanki

package = ROOT / 'build/demo/AnkiCode-Demo.apkg'
col, notes, cards, media = read_package(package)
assert len(notes) == len(cards) == 2
assert len({n['guid'] for n in notes.values()}) == 2
assert {n['mid'] for n in notes.values()} == {1996101601, 1996101602}
assert {c['did'] for c in cards} == {1996101611, 1996101612}
assert sorted(c['due'] for c in cards) == [1, 2]
models = json.loads(col['models'])
meter = json.loads((ROOT / 'examples/cards.json').read_text(encoding='utf-8'))['meter']
for index, language in enumerate(('python', 'javascript'), 1):
    model = models[str(1996101600 + index)]
    assert [field['name'] for field in model['flds']] == fields
    note = next(note for note in notes.values() if note['mid'] == 1996101600 + index)
    values = dict(zip(fields, note['flds'].split('\x1f'), strict=True))
    assert note['guid'] == genanki.guid_for('ankicode/publication-demo/v1', language, meter['slug'])
    assert values['Description'] == meter['description']
    assert values['Title'] == meter['title'] and values['TitleSlug'] == meter['slug']
    assert html.unescape(values['CodeSnippets']) == meter[language + 'Starter']
    assert values['Solution'] == '<pre><code>' + html.escape(meter[language + 'Solution']) + '</code></pre>'
    assert values['Notes'] == values['Prompt'] == ''
    assert values['Id'] == '1' and values['Difficulty'] == 'Demo'
    assert values['TopicTags'] == json.dumps({'array': 'Array', 'math': 'Math'})
    assert values['Hints'] == '<p>Four original test cases. Run your own examples or choose Tests.</p>'
    assert html.unescape(values['EntryPoint']) == ('Solution().totalDelta' if language == 'python' else 'totalDelta')
    assert 'leetcode.com/problems/' not in json.dumps(model)
with zipfile.ZipFile(package) as archive:
    db = sqlite3.connect(':memory:')
    db.deserialize(archive.read('collection.anki2'))
    assert db.execute('SELECT count(*) FROM revlog').fetchone()[0] == 0
    db.close()
    for card in cards:
        assert all(card[key] == 0 for key in ('type', 'queue', 'ivl', 'reps', 'lapses', 'odue', 'odid'))
    required = {'_ankicode-LICENSE-GPL-3.0.txt', '_ankicode-original-examples-MIT.txt',
                '_ankicode-third-party-notices.md', '_codemirror6.js', '_pro-runtime.js',
                '_highlight.min.js', '_python.min.js', '_atom-one-dark.min.css', '_katex.css',
                '_cm6-LICENSES.txt', '_javascript-editor.js', '_javascript-runtime.js',
                '_javascript-LICENSES.txt', '_javascript-atom-one-dark.min.css', '_javascript-katex.css',
                '_ankicode-notice-anki-persistence-MIT.txt', '_ankicode-notice-highlightjs-BSD-3-Clause.txt',
                '_ankicode-notice-KaTeX-MIT.txt'}
    assert required == set(media), 'Unexpected or missing package media'
    assert set(archive.namelist()) == {'collection.anki2', 'media'} | set(json.loads(archive.read('media')))
    for key, name in json.loads(archive.read('media')).items():
        assert Path(name).name == name
        assert archive.read(key) == (ROOT / 'build/demo' / name).read_bytes(), name
    # Scan every textual archive member, including decoded SQLite rows below.
    content = '\n'.join(archive.read(key).decode('utf-8') for key in json.loads(archive.read('media')))
    content += '\n' + json.dumps(col) + '\n' + json.dumps(list(notes.values()))
    forbidden = ('_' + 'private', 'build_' + 'pro_deck',
                 'build_' + 'javascript_deck', 'build_' + 'sql_deck',
                 'neetcode.' + 'catalog', 'neetcode.' + 'test_codegen')
    assert not any(token in content for token in forbidden), 'Archive or documentation reference in APKG'
    local_references = re.sub(r'https?://[^\s<>\"\']+', '', content)
    assert not re.search(r'(?i)\bdocs[\\/]', local_references), 'Archived documentation reference in APKG'
for language in ('python', 'javascript'):
    front = (ROOT / 'build/demo' / f'{language}-front.html').read_text(encoding='utf-8')
    assert not re.search(r'{{\w+}}', front), language
    for path in re.findall(r'(?:src\s*=\s*["\']|url\(["\']?)([^"\'\s)]+)', front):
        if path.startswith('_'):
            assert path in media, path
    for field in ('code-snippets', 'test-code', 'prompt', 'entry-point', 'topic-tags', 'title-slug'):
        raw = re.search(fr'<textarea id="field-{field}">(.*?)</textarea>', front, re.S)[1]
        assert '</textarea' not in raw.lower()
        assert isinstance(html.unescape(raw), str)
    assert 'https://leetcode.com/problems/ankicode-demo-' not in front
assert all(token not in (ROOT / 'build/demo/_pro-runtime.js').read_text(encoding='utf-8')
           for token in ('_sol', '_methods'))
report = {'result': 'PASS', 'cards': 2, 'fields': fields, 'media': sorted(media),
          'content': 'Only the original exercise; no datasets, external problem prose or documentation payloads',
          'identities': 'Original Python/JavaScript model IDs, deck IDs and GUID scheme retained',
          'oldFallbackStringsAbsent': True}
(ROOT / 'build/demo-audit-results.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
