"""Read APKG content and compare stable note/card identity independently of builders."""
import hashlib
import json
import sqlite3
import zipfile


def read_package(path, normalize_media_newlines=False):
    with zipfile.ZipFile(path) as archive:
        db = sqlite3.connect(":memory:")
        db.deserialize(archive.read("collection.anki2"))
        db.row_factory = sqlite3.Row
        col = dict(db.execute("SELECT * FROM col").fetchone())
        notes = {r["id"]: dict(r) for r in db.execute("SELECT * FROM notes")}
        cards = [dict(r) for r in db.execute("SELECT * FROM cards")]
        def media_hash(key, name):
            content = archive.read(key)
            if normalize_media_newlines and name.endswith((".js", ".css")):
                content = content.replace(b"\r\n", b"\n")
            return hashlib.sha256(content).hexdigest()
        media = {name: media_hash(key, name)
                 for key, name in json.loads(archive.read("media")).items()}
        db.close()
    return col, notes, cards, media


def normalized_model(models):
    models = json.loads(models)
    for model in models.values():
        model.pop("mod", None)
    return models


def compare_content(reference, actual, allow_ui_changes=False):
    rc, rn, rr, rm = reference
    ac, an, ar, am = actual
    old_models, new_models = normalized_model(rc["models"]), normalized_model(ac["models"])
    if allow_ui_changes:
        for models in (old_models, new_models):
            for model in models.values():
                model.pop("css")
                for template in model["tmpls"]:
                    template.pop("qfmt")
                    template.pop("afmt")
    assert old_models == new_models, "Model changed"
    assert json.loads(rc["decks"]) == json.loads(ac["decks"]), "Decks changed"
    if not allow_ui_changes:
        assert rm == am, "Media changed"
    # genanki regenerates timestamp-based row IDs and modification times on
    # every build; note GUIDs, model IDs, deck IDs and card ordinals are stable.
    def note_content(notes):
        return {n["guid"]: {k: v for k, v in n.items() if k not in ("id", "mod")}
                for n in notes.values()}
    def card_content(cards, notes):
        return {(notes[c["nid"]]["guid"], c["ord"]):
                {k: v for k, v in c.items() if k not in ("id", "nid", "mod", "due")}
                for c in cards}
    assert note_content(rn) == note_content(an), "Note content or GUID changed"
    assert card_content(rr, rn) == card_content(ar, an), "Card content/topic changed"


