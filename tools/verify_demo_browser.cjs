// Serve build/demo on a free local port and run every tests/browser/*.cjs check
// in headless Chromium. Playwright is a test tool, not a project dependency:
// install it into build/browser-tools (see README) or set ANKICODE_PLAYWRIGHT_DIR.
// ANKICODE_CHROMIUM may point at an existing Chromium executable.
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createRequire} = require('node:module');

const root = path.resolve(__dirname, '..');
const demo = path.join(root, 'build/demo');
const checks = path.join(root, 'tests/browser');
const tools = process.env.ANKICODE_PLAYWRIGHT_DIR || path.join(root, 'build/browser-tools');

function loadPlaywright() {
  try {
    return createRequire(path.join(tools, 'package.json'))('playwright');
  } catch {
    console.error('Playwright not found in ' + tools + '. Install it with:\n' +
      '  npm install --prefix build/browser-tools playwright\n' +
      '  npx --prefix build/browser-tools playwright install chromium');
    process.exit(2);
  }
}

const types = {'.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
  '.css': 'text/css', '.txt': 'text/plain', '.md': 'text/plain'};
const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const target = path.resolve(demo, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
  if (!target.startsWith(demo + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const data = await fs.readFile(target);
    res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});

(async () => {
  const {chromium} = loadPlaywright();
  await fs.access(path.join(demo, 'index.html')).catch(() => {
    throw new Error('build/demo is missing. Run build_demo.py first.');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({headless: true,
    ...(process.env.ANKICODE_CHROMIUM ? {executablePath: process.env.ANKICODE_CHROMIUM} : {})});
  const report = {browser: browser.version(), checks: {}};
  // One context shares the HTTP cache, so Pyodide (~10 MB) downloads once
  // instead of once per check. Each page still has its own sessionStorage.
  const context = await browser.newContext();
  try {
    for (const name of (await fs.readdir(checks)).filter(file => file.endsWith('.cjs')).sort()) {
      const page = await context.newPage();
      try {
        report.checks[name] = await require(path.join(checks, name))(page, base);
        console.log('PASS ' + name);
      } catch (error) {
        report.checks[name] = {result: 'FAIL', error: String(error.stack || error)};
        console.log('FAIL ' + name + '\n' + String(error.message || error));
        process.exitCode = 1;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
  report.result = process.exitCode ? 'FAIL' : 'PASS';
  await fs.writeFile(path.join(root, 'build/demo-browser-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(report.result + ': ' + Object.keys(report.checks).length + ' browser checks. Details in build/demo-browser-results.json');
})().catch(error => { console.error(error.message || error); process.exitCode = 1; }).finally(() => server.close());
