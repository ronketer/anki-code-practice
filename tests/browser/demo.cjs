// Full demo walkthrough: type, Run, Tests (pass and fail), drafts, dark mode and Reset.
module.exports = async (page, base = 'http://127.0.0.1:8879/') => {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const solutions = await (await page.request.get(base + 'solutions.json')).json();
  const results = [];
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const ready = () => page.waitForFunction(() => window.AnkiCodeCard?.editor && !document.querySelector('#test-button').disabled);
  const value = () => page.evaluate(() => window.AnkiCodeCard.editor.getValue());
  const set = text => page.evaluate(text => window.AnkiCodeCard.editor.setValue(text), text);
  const finish = async () => {
    await page.waitForFunction(() => !document.querySelector('#test-button').disabled, null, {timeout:125000});
    return page.locator('#output-window').textContent();
  };
  for (const language of ['python', 'javascript']) {
    await page.goto(base + language + '-front.html'); await ready();
    const starter = await value();
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    const runCode = language === 'python' ? 'print("demo-run-ok")'
      : 'console.log("demo-run-ok");';
    await page.keyboard.insertText(runCode);
    assert(await value() === runCode, language + ': editor keyboard input failed');
    await page.click('#run-button');
    const ran = await finish();
    assert(ran.includes('demo-run-ok'), language + ': Run failed. Output: ' + ran);
    assert(await page.locator('#output-window').getAttribute('class') !== 'error', language + ': Run marked as failed');
    await set(language === 'python' ? 'raise ValueError("demo-run-failure")'
      : 'throw new Error("demo-run-failure");');
    await page.click('#run-button');
    const failed = await finish();
    assert(failed.includes('demo-run-failure'), language + ': Run error was lost. Output: ' + failed);
    assert(await page.locator('#output-window').getAttribute('class') === 'error', language + ': Run error not marked');
    await set(solutions[language]);
    await page.click('#test-button');
    const correct = await finish();
    assert(correct.includes('4/4 tests passed'), language + ': correct solution rejected: ' + correct);
    assert(await page.locator('#output-window').getAttribute('class') === 'success', language + ': Tests pass flag missing');
    await set(language === 'python' ? 'class Solution:\n    def totalDelta(self, deltas):\n        return 0'
      : 'var totalDelta = function() { return 0; };');
    await page.click('#test-button');
    const wrong = await finish();
    assert(wrong.includes('1/4 tests passed'), language + ': wrong solution accepted');
    assert(await page.locator('#output-window').getAttribute('class') === 'error', language + ': Tests failure flag missing');
    await set('original-demo-draft-' + language);
    await page.goto(base + language + '-back.html'); await ready();
    assert(await value() === 'original-demo-draft-' + language, language + ': answer lost draft');
    await page.goto(base + language + '-front.html'); await ready();
    assert(await value() === starter, language + ': later encounter retained old draft');
    await page.evaluate(() => document.body.classList.add('nightMode'));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.cm-editor')).color === 'rgb(201, 209, 217)');
    await set('draft-before-reset');
    await page.click('#reset-button');
    assert(await value() === starter, language + ': Reset did not restore starter');
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+z');
    assert(await value() === starter, language + ': Reset retained undo history');
    assert(await page.locator('.cm-editor').evaluate(el => getComputedStyle(el).color) === 'rgb(201, 209, 217)', language + ': Reset lost live theme');
    results.push({language, keyboardAndRun:true, runError:'reported', correct:'4/4 accepted', incorrect:'1/4 rejected', draftAnswerAndEncounterReset:true, themeAndUndoReset:true});
  }
  assert(errors.length === 0, 'Browser errors: ' + errors.join('\n'));
  return {result:'PASS', results, pageErrors:errors, note:'Real production workers; original publication-demo content only'};
};
