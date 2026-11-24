import contextlib
import io
import unittest

from ankicode.test_generator import COMPARE_MODES, build_test_code


def suite(source, candidate, slug='original-fixture'):
    namespace = {}
    exec(build_test_code(slug, source), namespace)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        result = namespace['check'](candidate)
    return result, output.getvalue()


class GeneratorTests(unittest.TestCase):
    def test_keyword_values_become_positional_in_written_order(self):
        result, output = suite('def check(candidate):\n assert candidate(start=13, change=-4) == 9',
                               lambda a, b, /: a + b)
        self.assertTrue(result)
        self.assertEqual(output, '1/1 tests passed\n')

    def test_partial_failure_keeps_running_and_names_errors(self):
        seen = []

        def candidate(value):
            seen.append(value)
            if value == 2:
                raise LookupError('original fixture')
            return value

        result, output = suite('def check(candidate):\n assert candidate(1) == 1\n'
                               ' assert candidate(2) == 2\n assert candidate(3) == 8\n'
                               ' assert candidate(4) == 4', candidate)
        self.assertFalse(result)
        self.assertEqual(seen, [1, 2, 3, 4])
        self.assertIn('2/4 tests passed', output)
        self.assertIn('assert candidate(2) == 2 — LookupError', output)
        self.assertIn('assert candidate(3) == 8 — AssertionError', output)

    def test_failure_limit_does_not_limit_execution(self):
        result, output = suite('def check(candidate):\n' + ''.join(
            f' assert candidate({index}) == 99\n' for index in range(14)), lambda x: x)
        self.assertFalse(result)
        self.assertEqual(output.count('AssertionError'), 10)
        self.assertIn('0/14 tests passed', output)

    def test_mutating_candidate_does_not_change_expected_or_next_run(self):
        code = build_test_code('original', 'def check(candidate):\n assert candidate([2, 7]) == [2, 7]')
        namespace = {}
        exec(code, namespace)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(namespace['check'](lambda values: values.pop()))
            self.assertTrue(namespace['check'](lambda values: values))

    def test_outer_order_and_multiplicity(self):
        source = 'def check(candidate):\n assert candidate(items=[4, 4, 9]) == [4, 4, 9]'
        self.assertTrue(suite(source, lambda x: [9, 4, 4], 'top-k-frequent-elements')[0])
        self.assertFalse(suite(source, lambda x: [9, 4], 'top-k-frequent-elements')[0])
        paths = 'def check(candidate):\n assert candidate(1) == [[2, 5], [5, 2]]'
        self.assertFalse(suite(paths, lambda x: [[2, 5], [2, 5]], 'permutations')[0])

    def test_outer_inner_order_and_multiplicity(self):
        source = 'def check(candidate):\n assert candidate(0) == [[2, 5], [7, 7]]'
        self.assertTrue(suite(source, lambda x: [[7, 7], [5, 2]], 'subsets')[0])
        self.assertFalse(suite(source, lambda x: [[7], [5, 2]], 'subsets')[0])
        self.assertFalse(suite(source, lambda x: None, 'subsets')[0])

    def test_two_sum_modes_accept_alternative_indices_and_reject_bad_indices(self):
        for slug, offset in [('two-sum', 0), ('two-sum-ii-input-array-is-sorted', 1)]:
            source = f'def check(candidate):\n assert candidate(numbers=[2, 2, 5, 5], target=7) == [{offset}, {offset+2}]'
            self.assertTrue(suite(source, lambda *args: [offset+3, offset+1], slug)[0])
            for wrong in ([offset, offset], [offset-1, offset+2], [offset, offset+4],
                          [offset, offset+1], [True, offset+2], [float(offset), offset+2], None):
                with self.subTest(slug=slug, wrong=wrong):
                    self.assertFalse(suite(source, lambda *args: wrong, slug)[0])
            missing = 'def check(candidate):\n assert candidate([3, 8], 99) == None'
            self.assertTrue(suite(missing, lambda *args: None, slug)[0])
            self.assertTrue(suite(missing, lambda *args: [], slug)[0])

    def test_default_mode_preserves_order(self):
        self.assertFalse(suite('def check(candidate):\n assert candidate(0) == [2, 7]',
                               lambda x: [7, 2])[0])
        self.assertEqual(set(COMPARE_MODES.values()), {'outer', 'outer_inner', 'two_sum_0', 'two_sum_1'})

    def test_values_that_look_like_template_text_are_preserved(self):
        text = "records = RECORDS comparison = COMPARISON '''"
        result, output = suite(f'def check(candidate):\n assert candidate({text!r}) == {text!r}', lambda s: s)
        self.assertTrue(result)
        self.assertEqual(output, '1/1 tests passed\n')

    def test_invalid_and_empty_inputs(self):
        for source in ('', None, 'bad syntax!', 'def check(candidate):\n pass',
                       'def other(candidate):\n assert candidate(1) == 1',
                       'def check(candidate):\n assert candidate(x=helper()) == 2',
                       'def check(candidate):\n assert candidate(**{}) == 2',
                       'def check(candidate):\n assert candidate(*[]) == 2',
                       'def check(candidate):\n assert candidate(1) != 2',
                       'def check(candidate):\n assert candidate(1) == 1 == 1',
                       'def check(candidate):\n assert other(1) == 1',
                       'def check(candidate):\n return True',
                       'def check(candidate):\n assert candidate(1) == 1\nprint(1)'):
            with self.subTest(source=source), self.assertRaises(ValueError):
                build_test_code('original', source)


if __name__ == '__main__':
    unittest.main()
