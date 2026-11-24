"""Pre-publication audit: scan the files git would publish for things that must not ship.

Checks for private folders, deck data and packages, credentials, personal paths
and email addresses, copied problem statements, unexpected binaries, oversized
files, unresolved local Python imports and broken links in Markdown. Prints a
JSON report and exits 1 on any failure. This is a heuristic safety net, not
proof that nothing sensitive is present. Never prints secret values.
"""
import ast
import fnmatch
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 2_000_000
IMAGE_SUFFIXES = {'.png', '.gif', '.jpg', '.jpeg', '.webp'}
FORBIDDEN_SUFFIXES = {'.apkg', '.colpkg', '.anki2', '.sqlite', '.db', '.pem', '.key', '.zip', '.gz',
                      '.wasm', '.dll', '.exe', '.pyc'}
FORBIDDEN_NAMES = {'neetcode-150-list.json', 'credentials.json', 'cookie.dat', '.npmrc', '.pypirc'}
FORBIDDEN_NAME_PATTERNS = ('grind169-*', '.env', '.env.*', '*-validation.json', '*-coverage.json', '*-results.json')
FORBIDDEN_DIRECTORIES = {'_private', 'data', 'build', 'node_modules', '.venv'}
# License texts and generated bundles legitimately contain authors' emails.
EMAIL_ALLOWED = ('LICENSE', 'LICENSES/*', 'examples/LICENSE', '*LICENSES.txt', 'card-template/js/*')
SECRETS = {
    'GitHub token': r'\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b',
    'AWS access key': r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
    'private key': r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
    'Google API key': r'\bAIza[0-9A-Za-z_-]{35}\b',
    'Slack token': r'\bxox[baprs]-[0-9A-Za-z-]{20,}\b',
    'Anthropic or OpenAI key': r'\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b',
    'literal credential assignment': r'''(?i)(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|LEETCODE_SESSION)\s*[:=]\s*["'][^"'\r\n]{16,}["']''',
}
PERSONAL_PATH = r'[A-Z]:[\\/](?:Users|Documents and Settings)[\\/][^\s"\'<>]+|/(?:home|Users)/[A-Za-z0-9._-]+/'
EMAIL = r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'
# Markers typical of copied LeetCode/NeetCode problem statements.
STATEMENT = r'(?m)^\s*(?:<[^>]+>\s*)*(?:Example \d+:|Constraints:|Follow[- ]up:)|\bInput:\s*\w+\s*='


def candidate_files():
    """Files git would publish; a .gitignore-aware walk before git init."""
    try:
        listed = subprocess.run(['git', 'ls-files', '-co', '--exclude-standard', '-z'], cwd=ROOT,
                                capture_output=True, check=True).stdout.decode().split('\0')
        return sorted(name for name in listed if name)
    except (OSError, subprocess.CalledProcessError):
        pass
    patterns = [line.strip() for line in (ROOT / '.gitignore').read_text(encoding='utf-8').splitlines()
                if line.strip() and not line.startswith('#')]

    def ignored(relative, is_dir):
        for pattern in patterns:
            directory_only = pattern.endswith('/')
            pattern = pattern.rstrip('/')
            if directory_only and not is_dir:
                continue
            if pattern.startswith('/'):
                if fnmatch.fnmatch(relative, pattern[1:]):
                    return True
            elif fnmatch.fnmatch(Path(relative).name, pattern):
                return True
        return False

    found = []
    for directory, folders, names in os.walk(ROOT):
        base = Path(directory).relative_to(ROOT)
        folders[:] = [f for f in folders if f != '.git' and not ignored((base / f).as_posix(), True)]
        found += [(base / n).as_posix() for n in names if not ignored((base / n).as_posix(), False)]
    return sorted(found)


def local_module_exists(module):
    path = ROOT / module.replace('.', '/')
    return path.with_suffix('.py').is_file() or (path / '__init__.py').is_file()


def check_file(relative, failures):
    path = ROOT / relative
    fail = lambda reason: failures.append({'path': relative, 'reason': reason})
    parts, name = Path(relative).parts, path.name
    if (FORBIDDEN_DIRECTORIES & set(parts[:-1]) or name in FORBIDDEN_NAMES
            or path.suffix.lower() in FORBIDDEN_SUFFIXES
            or any(fnmatch.fnmatch(name, pattern) for pattern in FORBIDDEN_NAME_PATTERNS)):
        fail('excluded data, package, build output or credential file')
        return
    data = path.read_bytes()
    if len(data) > MAX_BYTES:
        fail(f'larger than {MAX_BYTES // 1_000_000} MB')
    if path.suffix.lower() in IMAGE_SUFFIXES:
        return
    try:
        content = data.decode('utf-8')
    except UnicodeDecodeError:
        fail('unexpected binary file')
        return
    for label, expression in SECRETS.items():
        if re.search(expression, content):
            fail(label)
    if re.search(PERSONAL_PATH, content):
        fail('absolute personal path')
    if not any(fnmatch.fnmatch(relative, pattern) for pattern in EMAIL_ALLOWED):
        emails = {e for e in re.findall(EMAIL, content) if 'noreply' not in e and not e.endswith('.example')}
        if emails:
            fail(f'{len(emails)} email address(es)')
    if not relative.startswith('card-template/js/') and re.search(STATEMENT, content):
        fail('looks like a copied problem statement')
    if path.suffix == '.py':
        try:
            tree = ast.parse(content)
        except SyntaxError:
            fail('invalid Python source')
            return
        for node in ast.walk(tree):
            modules = ([node.module] if isinstance(node, ast.ImportFrom) and node.module and not node.level
                       else [item.name for item in node.names] if isinstance(node, ast.Import) else [])
            for module in modules:
                top = module.split('.')[0]
                if (top not in sys.stdlib_module_names and top not in {'genanki', 'anki', 'google'}
                        and not local_module_exists(module)):
                    fail('unresolved import: ' + module)
    if path.suffix == '.md':
        rendered = re.sub(r'<!--.*?-->', '', content, flags=re.S)  # comments aren't shown on GitHub
        for target in re.findall(r'\]\(([^)#\s]+)', rendered):
            if not re.match(r'[a-z]+:', target) and not (path.parent / target).exists():
                fail('broken link: ' + target)


def main():
    failures = []
    if (ROOT / '_private').exists():
        failures.append({'path': '_private/', 'reason': 'private folder must live outside the repository'})
    files = candidate_files()
    for relative in files:
        check_file(relative, failures)
    print(json.dumps({'result': 'FAIL' if failures else 'PASS', 'filesScanned': len(files),
                      'failures': failures}, indent=2))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
