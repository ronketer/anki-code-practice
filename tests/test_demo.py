import contextlib
import io
import json
from pathlib import Path
import unittest

from ankicode.js_harness import test_cases
from ankicode.test_generator import build_test_code

ROOT = Path(__file__).resolve().parents[1]


class DemoTests(unittest.TestCase):
    def test_generated_python_grades_original_examples(self):
        meter = json.loads((ROOT / 'examples/cards.json').read_text(encoding='utf-8'))['meter']
        namespace = {}
        exec(build_test_code(meter['slug'], meter['assertions']), namespace)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertTrue(namespace['check'](sum))
            self.assertFalse(namespace['check'](lambda deltas: 0))

    def test_javascript_case_adapter_accepts_literals_and_rejects_helpers(self):
        self.assertEqual(test_cases('def check(candidate):\n assert candidate(deltas=[4, -9, 12]) == 7'), [[[[4, -9, 12]], 7]])
        for source in ('def check(candidate):\n assert candidate(helper()) == 7',
                       'def check(candidate):\n assert candidate(9007199254740992) == 0',
                       'def check(candidate):\n assert candidate(4) != 7'):
            with self.assertRaises(ValueError):
                test_cases(source)



if __name__ == '__main__':
    unittest.main()
