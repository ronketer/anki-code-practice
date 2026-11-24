"""Turn literal candidate assertions into an isolated, reporting test suite."""
import ast
import textwrap


# These results are unordered by the exercise's contract. Inner order still
# matters for permutations, paths, partitions, and coordinate pairs.
COMPARE_MODES = {
    **dict.fromkeys((
        'permutations', 'permutations-ii', 'palindrome-partitioning',
        'letter-combinations-of-a-phone-number', 'generate-parentheses',
        'top-k-frequent-elements', 'intersection-of-two-arrays',
        'intersection-of-two-arrays-ii', 'word-search-ii',
        'pacific-atlantic-water-flow', 'remove-invalid-parentheses',
        'different-ways-to-add-parentheses',
    ), 'outer'),
    **dict.fromkeys((
        'group-anagrams', 'subsets', 'subsets-ii', '3sum', '4sum',
        'combination-sum', 'combination-sum-ii', 'combination-sum-iii',
        'combinations',
    ), 'outer_inner'),
    'two-sum': 'two_sum_0',
    'two-sum-ii-input-array-is-sorted': 'two_sum_1',
}


def parse_assertions(test_src):
    """Read `def check(candidate)` made only of `assert candidate(...) == literal`.

    Returns (arguments, expected, assertion source) per assertion. Keyword
    arguments become positional values in their written order. Anything else,
    including an empty suite, raises ValueError rather than being skipped.
    """
    try:
        module = ast.parse(test_src)
        if len(module.body) != 1 or not isinstance(module.body[0], ast.FunctionDef):
            raise ValueError('expected one check function')
        function = module.body[0]
        if (function.name != 'check' or function.decorator_list
                or ast.unparse(function.args) != 'candidate'):
            raise ValueError('expected check(candidate)')
        records = []
        for statement in function.body:
            if not isinstance(statement, ast.Assert):
                raise ValueError('expected an equality assertion')
            expression = statement.test
            if (not isinstance(expression, ast.Compare) or len(expression.ops) != 1
                    or not isinstance(expression.ops[0], ast.Eq)):
                raise ValueError('expected an equality assertion')
            invocation = expression.left
            if (not isinstance(invocation, ast.Call)
                    or not isinstance(invocation.func, ast.Name)
                    or invocation.func.id != 'candidate'
                    or any(item.arg is None for item in invocation.keywords)):
                raise ValueError('expected candidate with explicit arguments')
            arguments = [ast.literal_eval(item) for item in invocation.args]
            arguments.extend(ast.literal_eval(item.value) for item in invocation.keywords)
            records.append((arguments, ast.literal_eval(expression.comparators[0]),
                            ast.get_source_segment(test_src, statement)))
        if not records:
            raise ValueError('empty test suite')
    except (SyntaxError, TypeError) as error:
        raise ValueError('invalid test suite') from error
    return records


def build_test_code(slug, test_src):
    """Return Python source for a check(candidate) that runs every assertion.

    It prints "passed/total tests passed" plus up to ten failures and returns
    True only when all pass. COMPARE_MODES picks order-insensitive or Two Sum
    style grading for the listed slugs.
    """
    records = parse_assertions(test_src)
    # Data is concatenated, never substituted into the template, so test
    # values can contain any text.
    return ('def check(candidate):\n'
            f'    records = {records!r}\n'
            f'    comparison = {COMPARE_MODES.get(slug)!r}\n'
            + textwrap.indent(textwrap.dedent(_CHECK_BODY).strip('\n'), '    ') + '\n')


_CHECK_BODY = '''
        from collections import Counter
        from copy import deepcopy

        def freeze(value):
            if isinstance(value, (list, tuple)):
                return tuple(map(freeze, value))
            if isinstance(value, dict):
                return frozenset((freeze(key), freeze(item)) for key, item in value.items())
            if isinstance(value, set):
                return frozenset(map(freeze, value))
            return value

        def unordered(value):
            if not isinstance(value, (list, tuple)):
                raise TypeError('expected a sequence')
            if comparison == 'outer_inner':
                return Counter(tuple(sorted(map(freeze, group), key=repr)) for group in value)
            return Counter(map(freeze, value))

        successes = 0
        failures = []
        for arguments, expected, assertion in records:
            try:
                actual = candidate(*deepcopy(arguments))
                if comparison in ('two_sum_0', 'two_sum_1'):
                    if expected is None:
                        valid = actual is None or actual == []
                    else:
                        valid = isinstance(actual, (list, tuple)) and len(actual) == 2
                        valid = valid and all(type(index) is int for index in actual)
                        if valid:
                            base = int(comparison == 'two_sum_1')
                            first, second = (index - base for index in actual)
                            numbers, target = arguments
                            valid = (first != second and 0 <= first < len(numbers)
                                     and 0 <= second < len(numbers)
                                     and numbers[first] + numbers[second] == target)
                elif comparison in ('outer', 'outer_inner'):
                    valid = unordered(actual) == unordered(expected)
                else:
                    valid = actual == expected
                if not valid:
                    raise AssertionError()
            except Exception as error:
                if len(failures) < 10:
                    failures.append(assertion + ' — ' + type(error).__name__)
            else:
                successes += 1
        print(str(successes) + '/' + str(len(records)) + ' tests passed')
        for failure in failures:
            print(failure)
        return successes == len(records)
'''
