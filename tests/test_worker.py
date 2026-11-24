"""Run the Python program embedded in the Pyodide worker with plain CPython."""
import contextlib
import io
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKER = (ROOT / 'card-template/editor/worker.mjs').read_text(encoding='utf-8')
PROGRAM = re.search(r'String\.raw`(.*?)`;', WORKER, re.S)[1]
TESTS = 'def check(candidate):\n assert candidate(6) == 12\n return True\n'


def execute(code, mode='test', prompt='', tests=TESTS, entry='Solution().original'):
    namespace = {'_anki_mode': mode, '_anki_prompt': prompt, '_anki_code': code,
                 '_anki_testCode': tests, '_anki_entryPoint': entry}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(PROGRAM, namespace)
    return namespace['_anki_passed']


class EntryPointTests(unittest.TestCase):
    def test_named_method_is_used(self):
        self.assertTrue(execute('class Solution:\n def original(self, v): return v * 2\n def other(self): pass'))

    def test_single_renamed_method_is_used(self):
        self.assertTrue(execute('class Solution:\n def renamed(self, v): return v * 2'))

    def test_several_public_methods_reraise(self):
        with self.assertRaisesRegex(AttributeError, "no attribute 'original'"):
            execute('class Solution:\n def first(self, v): return v\n def second(self): pass')

    def test_no_public_methods_reraise(self):
        with self.assertRaisesRegex(AttributeError, "no attribute 'original'"):
            execute('class Solution:\n def _hidden(self): pass')

    def test_static_and_inherited_helpers_are_not_candidates(self):
        self.assertTrue(execute('class Base:\n def helper(self): pass\n'
                                'class Solution(Base):\n tool = staticmethod(lambda: 0)\n'
                                ' def renamed(self, v): return v * 2'))

    def test_wrong_answer_is_reported_as_failure(self):
        self.assertFalse(execute('class Solution:\n def original(self, v): return v',
                                 tests='def check(candidate):\n return candidate(6) == 12\n'))


class ModeTests(unittest.TestCase):
    def test_typing_names_are_available_in_tests(self):
        self.assertTrue(execute('class Solution:\n def original(self, v: Optional[int]) -> List[int]:'
                                ' return v * 2'))

    def test_prompt_runs_before_code_in_run_mode(self):
        self.assertIsNone(execute('print(double(3))', mode='run', prompt='def double(v): return v * 2'))

    def test_run_mode_does_not_execute_tests(self):
        self.assertIsNone(execute('x = 1', mode='run', tests='raise RuntimeError("tests ran")'))


if __name__ == '__main__':
    unittest.main()
