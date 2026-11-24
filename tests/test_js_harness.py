"""Generate JavaScript harnesses and run them in Node like the card worker does."""
import json
import shutil
import subprocess
import unittest

from ankicode.js_harness import harness, test_cases

NODE = shutil.which('node')
# Same shape as card-template/javascript/worker.mjs: solution + harness in one function body.
RUNNER = ('let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const {body}=JSON.parse(s);'
          'const logs=[];console.log=m=>logs.push(String(m));'
          'const passed=new Function(\'"use strict";\\n\'+body)();'
          'process.stdout.write(JSON.stringify({passed,logs}));});')


def run(solution, assertions, entry='solve', mode=None):
    body = solution + '\n' + harness(test_cases(assertions), entry, mode)
    result = subprocess.run([NODE, '-e', RUNNER], input=json.dumps({'body': body}),
                            capture_output=True, text=True, timeout=30, check=True)
    return json.loads(result.stdout)


@unittest.skipUnless(NODE, 'Node.js is not installed')
class HarnessExecutionTests(unittest.TestCase):
    def test_correct_and_wrong_solutions(self):
        source = 'def check(candidate):\n assert candidate([4, -9, 12]) == 7\n assert candidate([]) == 0'
        good = run('const solve = d => d.reduce((a, b) => a + b, 0);', source)
        self.assertTrue(good['passed'])
        self.assertEqual(good['logs'][-1], '2/2 tests passed')
        bad = run('const solve = () => 0;', source)
        self.assertFalse(bad['passed'])
        self.assertIn('FAIL 1: input=[[4,-9,12]] expected=7 got=0', bad['logs'])

    def test_text_that_looks_like_template_markers_is_preserved(self):
        source = 'def check(candidate):\n assert candidate("ENTRY MODE CASES __ENTRY__") == "ENTRY MODE CASES __ENTRY__"'
        self.assertTrue(run('const solve = s => s;', source)['passed'])

    def test_unordered_and_two_sum_modes(self):
        outer = 'def check(candidate):\n assert candidate(1) == [[1, 2], [3]]'
        self.assertTrue(run('const solve = () => [[3], [1, 2]];', outer, mode='outer')['passed'])
        self.assertFalse(run('const solve = () => [[3], [2, 1]];', outer, mode='outer')['passed'])
        self.assertTrue(run('const solve = () => [[3], [2, 1]];', outer, mode='outer_inner')['passed'])
        pair = 'def check(candidate):\n assert candidate([2, 2, 5, 5], 7) == [0, 2]'
        self.assertTrue(run('const solve = () => [3, 1];', pair, mode='two_sum_0')['passed'])
        self.assertFalse(run('const solve = () => [0, 1];', pair, mode='two_sum_0')['passed'])

    def test_float_tolerance_and_argument_isolation(self):
        self.assertTrue(run('const solve = () => 0.1 + 0.2;',
                            'def check(candidate):\n assert candidate() == 0.3')['passed'])
        mutate = 'def check(candidate):\n assert candidate([1]) == 1\n assert candidate([1]) == 1'
        self.assertTrue(run('const solve = a => { a.push(9); return a[0]; };', mutate)['passed'])


class HarnessValidationTests(unittest.TestCase):
    def test_rejected_sources_raise_value_error(self):
        for source in ('x = 1', 'def check(:', 'def check(candidate):\n assert candidate(4) != 7',
                       'def check(candidate):\n assert candidate(helper()) == 7',
                       'def check(candidate):\n assert candidate(9007199254740992) == 0',
                       'def check(candidate):\n assert candidate({"k": 9007199254740992}) == 0',
                       'def check(candidate):\n assert candidate(float("nan")) == 0',
                       'def check(candidate):\n assert candidate({1, 2}) == 0'):
            with self.subTest(source=source), self.assertRaises(ValueError):
                test_cases(source)

    def test_entry_point_must_be_a_name(self):
        cases = test_cases('def check(candidate):\n assert candidate(1) == 1')
        self.assertIn('Solution.solve(', harness(cases, 'Solution.solve', None))
        with self.assertRaises(ValueError):
            harness(cases, 'solve); alert(1', None)


if __name__ == '__main__':
    unittest.main()
