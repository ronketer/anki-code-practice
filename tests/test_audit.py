"""The publication audit must catch each planted problem in a throwaway repository."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('audit', ROOT / 'tools/audit_publication.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

# Split so this file does not trip the audit it tests.
PLANTED = {
    'notes.txt': 'saved under /ho' + 'me/alice/projects',
    'contact.md': 'Write to someone' + '@example.org',
    'problem.html': '<p><strong>Example' + ' 1:</strong></p>',
    'token.py': 'API_KEY = "' + 'abcdefghijklmnop' * 2 + '"',
    'deck.apkg': 'not really a deck',
    'links.md': '[missing](docs/nowhere.md)',
    'imports.py': 'import not_a_real_module',
    'blob.bin': b'\x00\xff\x00',
}


class AuditTests(unittest.TestCase):
    def run_audit(self, files):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / '.gitignore').write_text('/build/\n', encoding='utf-8')
            for name, content in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                (path.write_bytes if isinstance(content, bytes) else path.write_text)(content)
            original, audit.ROOT = audit.ROOT, root
            try:
                with contextlib.redirect_stdout(io.StringIO()) as output:
                    code = audit.main()
            finally:
                audit.ROOT = original
        return code, {f['path']: f['reason'] for f in json.loads(output.getvalue())['failures']}

    def test_every_planted_problem_is_reported(self):
        code, failures = self.run_audit({**PLANTED, '_private/x.txt': 'secret notes'})
        self.assertEqual(code, 1)
        self.assertIn('_private/', failures)
        for name in PLANTED:
            self.assertIn(name, failures, name)

    def test_clean_files_pass_and_ignored_build_is_skipped(self):
        code, failures = self.run_audit({'README.md': '# Title\n[ok](a.py)\n', 'a.py': 'import json\n',
                                         'build/out.apkg': 'generated'})
        self.assertEqual((code, failures), (0, {}))


if __name__ == '__main__':
    unittest.main()
