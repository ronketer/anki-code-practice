"""Import the demo deck into a throwaway Anki collection and check updates.

Uses the Python packages of an installed Anki, never your profile or decks.
Run with `python -B -S`. The Anki packages are found from --anki-package-dir,
the standard Windows or Linux install location, or an importable `anki`.
Writes build/demo-import-results.json.
"""
import argparse
from contextlib import nullcontext
import hashlib
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, default=ROOT / 'build/demo/AnkiCode-Demo.apkg')
    parser.add_argument('--anki-package-dir', type=Path,
                        help="folder that contains Anki's 'anki' Python package")
    args = parser.parse_args()
    sys.dont_write_bytecode = True
    candidates = [args.anki_package_dir] if args.anki_package_dir else [
        Path(os.environ['LOCALAPPDATA']) / 'Programs/Anki/app_packages' if 'LOCALAPPDATA' in os.environ else None,
        Path('/usr/local/share/anki/app_packages'),
    ]
    found = next((path for path in candidates if path and (path / 'anki').is_dir()), None)
    if found:
        sys.path.insert(0, str(found.resolve()))
    elif importlib.util.find_spec('anki') is None:
        sys.exit('Anki not found. Pass --anki-package-dir pointing at the folder that contains anki/.')
    from anki.collection import Collection, ImportAnkiPackageOptions, ImportAnkiPackageRequest
    from google.protobuf.json_format import MessageToDict

    package = args.package.resolve()
    digest = hashlib.sha256(package.read_bytes()).hexdigest()
    work_root = ROOT / 'build/import-check'
    work_root.mkdir(parents=True, exist_ok=True)
    # Retain isolated evidence under ignored build/. Avoid platform-specific
    # TemporaryDirectory ACL changes when using Windows application backends.
    with nullcontext(work_root / ('demo-import-' + uuid.uuid4().hex)) as work:
        work.mkdir()
        col = Collection(str(work / 'collection.anki2'))

        def load(path, always=False):
            response = col.import_anki_package(ImportAnkiPackageRequest(package_path=str(path),
                options=ImportAnkiPackageOptions(with_scheduling=False, with_deck_configs=False,
                    update_notes=1 if always else 0, update_notetypes=1 if always else 0)))
            log = MessageToDict(response, preserving_proto_field_name=True)['log']
            return {key: len(log.get(key, [])) for key in ('new', 'updated', 'duplicate', 'conflicting')}

        try:
            first = load(package)
            assert first['new'] == col.note_count() == col.card_count() == 2, first
            assert set(col.db.list('SELECT DISTINCT mid FROM notes')) == {1996101601, 1996101602}
            assert col.db.scalar('SELECT count(*) FROM revlog') == 0
            identity = col.db.all('SELECT guid,id FROM notes ORDER BY guid')
            card_ids = col.db.all('SELECT id,nid,ord,due FROM cards ORDER BY id')
            repeat = load(package)
            assert repeat == {'new': 0, 'updated': 0, 'duplicate': 2, 'conflicting': 0}, repeat
            assert card_ids == col.db.all('SELECT id,nid,ord,due FROM cards ORDER BY id')
            # Synthetic learning progress belongs only to this disposable collection.
            cid = col.find_cards('')[0]
            card = col.get_card(cid)
            card.type, card.queue, card.due, card.ivl = 2, 2, 42, 7
            card.factor, card.reps, card.lapses = 2300, 5, 1
            col.update_card(card)
            col.db.execute('INSERT INTO revlog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                           1700000000000, cid, -1, 3, 7, 3, 2300, 1000, 1)
            query = 'SELECT id,nid,ord,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data FROM cards ORDER BY id'
            scheduling = col.db.all(query)
            reviews = col.db.all('SELECT * FROM revlog ORDER BY id')
            # Simulate a future same-schema release changing a note and all templates.
            updated = work / 'updated.apkg'
            with zipfile.ZipFile(package) as archive:
                db = sqlite3.connect(':memory:')
                db.deserialize(archive.read('collection.anki2'))
                guid, fields = db.execute('SELECT guid,flds FROM notes ORDER BY guid LIMIT 1').fetchone()
                values = fields.split('\x1f')
                values[1] += ' (update verification)'
                db.execute('UPDATE notes SET flds=?, mod=mod+60 WHERE guid=?', ('\x1f'.join(values), guid))
                models = json.loads(db.execute('SELECT models FROM col').fetchone()[0])
                for model in models.values():
                    model['mod'] += 60
                    model['tmpls'][0]['afmt'] += '\n<!-- update verification -->'
                db.execute('UPDATE col SET models=?', (json.dumps(models),))
                db.commit()
                with zipfile.ZipFile(updated, 'w', zipfile.ZIP_DEFLATED) as output:
                    for name in archive.namelist():
                        output.writestr(name, db.serialize() if name == 'collection.anki2' else archive.read(name))
                db.close()
            change = load(updated, always=True)
            assert change == {'new': 0, 'updated': 1, 'duplicate': 1, 'conflicting': 0}, change
            assert col.db.scalar('SELECT flds FROM notes WHERE guid=?', guid) == '\x1f'.join(values)
            assert all('<!-- update verification -->' in col.models.get(mid)['tmpls'][0]['afmt']
                       for mid in (1996101601, 1996101602))
            assert identity == col.db.all('SELECT guid,id FROM notes ORDER BY guid')
            assert scheduling == col.db.all(query)
            assert reviews == col.db.all('SELECT * FROM revlog ORDER BY id')
        finally:
            col.close()
    assert hashlib.sha256(package.read_bytes()).hexdigest() == digest
    report = {'result': 'PASS', 'anki': importlib.metadata.version('anki'), 'packageSha256': digest,
              'fresh': first, 'repeat': repeat, 'sameSchemaUpdate': change,
              'preserved': ['note/card identities', 'learning progress', 'review log'],
              'scope': 'Installed Anki backend; disposable collection; no user profile accessed'}
    (ROOT / 'build/demo-import-results.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
