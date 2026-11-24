"""Build the demo deck: one original exercise as a Python card and a JavaScript card.

Reads examples/cards.json and card-template/, writes build/demo/:
  AnkiCode-Demo.apkg        the deck to import into Anki
  <language>-front.html     rendered card sides for previewing in a browser
  <language>-back.html
  solutions.json, index.html, and every media file the cards load
"""
import html
import json
from pathlib import Path
import re
import shutil

import genanki

from ankicode.js_harness import harness, test_cases
from ankicode.test_generator import build_test_code

ROOT = Path(__file__).resolve().parent
TEMPLATES = ROOT / 'card-template'
OUTPUT = ROOT / 'build/demo'
FIELDS = ['Id', 'Title', 'TitleSlug', 'TopicTags', 'Difficulty', 'Description',
          'Notes', 'CodeSnippets', 'Hints', 'Solution', 'EntryPoint', 'TestCode', 'Prompt']
# These fields are placed inside <textarea> elements as raw text. Escaping
# them means card content can never close the textarea or inject markup.
TEXTAREA_FIELDS = {'TitleSlug', 'TopicTags', 'CodeSnippets', 'EntryPoint', 'TestCode', 'Prompt'}
# Stable demo identities so re-importing updates the same notes.
MODEL_ID, DECK_ID, GUID_NAMESPACE = 1996101600, 1996101610, 'ankicode/publication-demo/v1'

LANGUAGES = {
    'python': {
        'label': 'Python',
        'front': TEMPLATES / 'front-pro.html', 'back': TEMPLATES / 'back-pro.html',
        'media': ['js/_codemirror6.js', 'js/_pro-runtime.js', 'js/_highlight.min.js', 'js/_python.min.js',
                  'css/_atom-one-dark.min.css', 'css/_katex.css', 'editor/_cm6-LICENSES.txt'],
    },
    'javascript': {
        'label': 'JavaScript',
        'front': TEMPLATES / 'javascript/front.html', 'back': TEMPLATES / 'javascript/back.html',
        'media': ['js/_javascript-editor.js', 'js/_javascript-runtime.js', 'javascript/_javascript-LICENSES.txt',
                  'javascript/_javascript-atom-one-dark.min.css', 'javascript/_javascript-katex.css'],
    },
}


def render(template, values):
    """Minimal Anki template rendering for the browser preview pages."""
    template = re.sub(r'{{#(\w+)}}(.*?){{/\1}}',
                      lambda match: match[2] if values.get(match[1]) else '', template, flags=re.S)
    return re.sub(r'{{(\w+)}}', lambda match: values[match[1]], template)


def demo_template(path, answer=False):
    """Demo problems have no LeetCode page, so drop the external problem links."""
    source = path.read_text(encoding='utf-8')
    source = source.replace('https://leetcode.com/problems/{{TitleSlug}}/', '#')
    if answer:
        source = re.sub(r'<nav class="problem-links".*?</nav>', '', source, flags=re.S)
    return source


def note_values(exercise, language):
    values = {
        'Id': '1',
        'Title': exercise['title'],
        'TitleSlug': exercise['slug'],
        'TopicTags': json.dumps({'array': 'Array', 'math': 'Math'}),
        'Difficulty': 'Demo',
        'Description': exercise['description'],
        'Notes': '',
        'CodeSnippets': exercise[language + 'Starter'],
        'Hints': '<p>Four original test cases. Run your own examples or choose Tests.</p>',
        'Solution': '<pre><code>' + html.escape(exercise[language + 'Solution']) + '</code></pre>',
        'EntryPoint': 'Solution().totalDelta' if language == 'python' else 'totalDelta',
        'TestCode': (build_test_code(exercise['slug'], exercise['assertions']) if language == 'python'
                     else harness(test_cases(exercise['assertions']), 'totalDelta', None)),
        'Prompt': '',
    }
    return {name: html.escape(value, quote=False) if name in TEXTAREA_FIELDS else value
            for name, value in values.items()}


def main():
    exercise = json.loads((ROOT / 'examples/cards.json').read_text(encoding='utf-8'))['meter']
    OUTPUT.mkdir(parents=True, exist_ok=True)
    css = (TEMPLATES / 'pro.css').read_text(encoding='utf-8')
    decks, previews, media = [], {}, {}
    for index, (language, spec) in enumerate(LANGUAGES.items(), 1):
        style = css
        if language == 'javascript':
            # Each language ships its own copy of the shared styles, so the
            # two note types can be updated independently in Anki.
            style = (css.replace('_atom-one-dark.min.css', '_javascript-atom-one-dark.min.css')
                     .replace('_katex.css', '_javascript-katex.css'))
        model = genanki.Model(MODEL_ID + index, 'AnkiCode Demo - ' + language,
                              fields=[{'name': name} for name in FIELDS],
                              templates=[{'name': language, 'qfmt': demo_template(spec['front']),
                                          'afmt': demo_template(spec['back'], answer=True)}],
                              css=style)
        values = note_values(exercise, language)
        deck = genanki.Deck(DECK_ID + index, 'AnkiCode Demo::' + spec['label'])
        deck.add_note(genanki.Note(model=model, fields=[values[name] for name in FIELDS],
                                   tags=['ankicode::original-demo'], due=index,
                                   guid=genanki.guid_for(GUID_NAMESPACE, language, exercise['slug'])))
        decks.append(deck)
        previews[language] = (model, values)
        media.update({path.name: TEMPLATES / path for path in map(Path, spec['media'])})

    # License texts travel inside the deck as well as with the source.
    for path in (ROOT / 'LICENSES').glob('*.txt'):
        media['_ankicode-notice-' + path.name] = path
    media['_ankicode-LICENSE-GPL-3.0.txt'] = ROOT / 'LICENSE'
    media['_ankicode-original-examples-MIT.txt'] = ROOT / 'examples/LICENSE'
    media['_ankicode-third-party-notices.md'] = ROOT / 'THIRD_PARTY_NOTICES.md'
    for name, source in media.items():
        shutil.copyfile(source, OUTPUT / name)

    package = OUTPUT / 'AnkiCode-Demo.apkg'
    genanki.Package(decks, media_files=[str(OUTPUT / name) for name in media]).write_to_file(str(package))

    for language, (model, values) in previews.items():
        front = render(model.templates[0]['qfmt'], values)
        back = render(model.templates[0]['afmt'], dict(values, FrontSide=front))
        for side, body in (('front', front), ('back', back)):
            (OUTPUT / f'{language}-{side}.html').write_text(
                '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                + '<style>' + model.css + '</style><body class="card">' + body, encoding='utf-8')
    solutions = {language: exercise[language + 'Solution'] for language in LANGUAGES}
    (OUTPUT / 'solutions.json').write_text(json.dumps(solutions, indent=2) + '\n', encoding='utf-8')
    (OUTPUT / 'index.html').write_text(
        '<!doctype html><meta charset="utf-8"><title>AnkiCode demo</title><h1>AnkiCode demo</h1>'
        + ''.join(f'<p><a href="{language}-front.html">{spec["label"]} card</a> · '
                  f'<a href="{language}-back.html">answer side</a></p>' for language, spec in LANGUAGES.items()),
        encoding='utf-8')
    print(f'Built {package.relative_to(ROOT)} with {len(decks)} cards.')
    print('Preview: uv run python -m http.server 8879 --bind 127.0.0.1 --directory build/demo')


if __name__ == '__main__':
    main()
