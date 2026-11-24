// Drafts survive Show Answer and remounts, reset on the next review, for every storage fallback.
module.exports = async (page, base = 'http://127.0.0.1:8879/') => {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const results = [];
  for (const deck of [
    {base, id: 'python', root: '#neet-pro'},
    {base, id: 'javascript', root: '#neet-pro'}
  ]) {
    const frontURL = deck.base + (deck.front || deck.id + '-front.html');
    const backURL = deck.base + (deck.back || deck.id + '-back.html');
    const front = await (await page.request.get(frontURL)).text();
    const back = await (await page.request.get(backURL)).text();
    const ready = () => page.waitForFunction(() => document.querySelector('.cm-editor') && !document.querySelector('#reset-button').disabled);
    const value = () => page.evaluate(() => window.AnkiCodeCard.editor.getValue());
    const set = text => page.evaluate(text => window.AnkiCodeCard.editor.setValue(text), text);
    // Use the real template bootstraps in a persistent reviewer document. An
    // optional old root remains connected to expose duplicate-ID mistakes.
    const swap = async (html, overlap = false, wait = true) => {
      await page.evaluate(({html, overlap}) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const container = document.createElement('div');
        container.innerHTML = doc.body.innerHTML;
        if (!overlap) document.body.replaceChildren();
        document.body.appendChild(container);
        for (const old of [...container.querySelectorAll('script')]) {
          const script = document.createElement('script');
          script.textContent = old.textContent;
          old.replaceWith(script);
        }
      }, {html, overlap});
      if (wait) await ready();
    };
    for (const host of ['sessionStorage', 'py', 'qt', 'window']) {
      await page.goto(frontURL);
      await ready();
      const starter = await value();
      if (host !== 'sessionStorage') await page.evaluate(host => {
        delete window.py; delete window.qt;
        if (host !== 'window') window[host] = {};
        Object.defineProperty(window, 'sessionStorage', {configurable: true, get() { throw Error('denied'); }});
      }, host);
      await swap(front);
      assert(await value() === starter, `${deck.id}/${host}: fresh question`);
      await set('current attempt');
      await page.evaluate(async selector => {
        const root = document.querySelector(selector);
        await (window.NeetCodePro || window.NeetCodeJavaScript).mount(root);
      }, deck.root);
      assert(await value() === 'current attempt', `${deck.id}/${host}: remount`);
      await swap(back, true);
      assert(await value() === 'current attempt', `${deck.id}/${host}: answer with overlapping roots`);
      assert(await page.locator('.cm-editor').count() === 1, 'Only the answer editor remains');
      await swap(front);
      assert(await value() === starter, `${deck.id}/${host}: later review`);
      await set('');
      await swap(back);
      assert(await value() === '', `${deck.id}/${host}: empty answer`);
      await swap(front);
      assert(await value() === starter, `${deck.id}/${host}: empty prior draft discarded`);
      await set('reset this');
      await page.click('#reset-button');
      assert(await value() === starter, `${deck.id}/${host}: Reset`);
      await swap(back);
      assert(await value() === starter, `${deck.id}/${host}: Reset survives answer`);
      await set('answer-side edit');
      await swap(front);
      assert(await value() === starter, `${deck.id}/${host}: answer edit discarded`);
      results.push(`${deck.id}/${host}: fresh, edit, remount, answer, later question, empty draft, Reset, overlapping roots`);
    }
    // Navigation also retains sessionStorage but must not retain an old attempt.
    await page.goto(frontURL); await ready();
    const starter = await value();
    await set('navigation attempt');
    await page.goto(backURL); await ready();
    assert(await value() === 'navigation attempt', 'Navigation to answer');
    await page.goto(frontURL); await ready();
    assert(await value() === starter, 'Navigation to later question');
    for (const asset of ['runtime', 'editor']) {
      const filename = await page.evaluate(asset => {
        if (window.NeetCodeJavaScript) return '_javascript-' + asset + '.js';
        return asset === 'runtime' ? '_pro-runtime.js' : '_codemirror6.js';
      }, asset);
      await set('stale before delayed load');
      let release;
      const requested = new Promise(resolve => { release = resolve; });
      await page.route('**/' + filename, route => release(route));
      try {
        await page.goto(frontURL, {waitUntil: 'domcontentloaded'});
        const held = await requested;
        await swap(back, false, false);
        await held.continue();
        await ready();
        assert(await value() === starter, `${deck.id}: answer before ${asset} loads`);
        assert(await page.locator('.cm-editor').count() === 1, 'Detached pending question ignored');
        await set('attempt after early reveal');
        await swap(back);
        assert(await value() === 'attempt after early reveal', 'Early answer remount preserves edits');
      } finally { await page.unroute('**/' + filename); }
      results.push(`${deck.id}: answer before ${asset} load, then answer remount`);
    }
  }
  return {result: 'PASS', results};
};
