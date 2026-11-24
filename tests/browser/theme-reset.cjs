// Reset keeps the live light/dark theme, clears undo history and persists the starter.
module.exports = async (page, base = 'http://127.0.0.1:8879/') => {
  const failures = [];
  const results = [];
  for (const initialDark of [false, true]) {
    const label = initialDark ? "dark → light → Reset" : "light → dark → Reset";
    await page.goto(base + "python-front.html");
    await page.waitForFunction(() => window.AnkiCodeCard?.editor);
    await page.evaluate(async initialDark => {
      window.AnkiCodeCard.destroy();
      document.body.className = initialDark ? "card nightMode" : "card";
      await window.NeetCodePro.mount(document.querySelector("#neet-pro"));
    }, initialDark);
    await page.waitForFunction(dark =>
      (getComputedStyle(document.querySelector(".cm-editor")).color === "rgb(201, 209, 217)") === dark, initialDark);
    const starter = await page.locator("#field-code-snippets").inputValue();
    // A real document transaction creates undo history, unlike setValue(..., true).
    await page.evaluate(() => window.AnkiCodeCard.editor.setValue("print('draft before reset')"));
    await page.evaluate(dark => document.body.className = dark ? "card nightMode" : "card", !initialDark);
    await page.waitForFunction(dark =>
      (getComputedStyle(document.querySelector(".cm-editor")).color === "rgb(201, 209, 217)") === dark, !initialDark);
    await page.click("#reset-button");
    const actual = await page.evaluate(() => ({
      dark: (getComputedStyle(document.querySelector(".cm-editor")).color === "rgb(201, 209, 217)"),
      code: window.AnkiCodeCard.editor.getValue(),
      outputClosed: !document.querySelector("#output-panel").open
    }));
    if (actual.dark !== !initialDark) failures.push(label + ": Reset restored the initial theme");
    if (actual.code !== starter || !actual.outputClosed) failures.push(label + ": Reset did not restore the starter/output");
    await page.keyboard.press("Control+z");
    if (await page.evaluate(() => window.AnkiCodeCard.editor.getValue()) !== starter)
      failures.push(label + ": Reset retained old undo history");
    await page.goto(base + "python-back.html");
    await page.waitForFunction(() => window.AnkiCodeCard?.editor);
    if (await page.evaluate(() => window.AnkiCodeCard.editor.getValue()) !== starter)
      failures.push(label + ": Reset did not persist the starter");
    results.push(label);
  }
  if (failures.length) throw new Error(failures.join("\n"));
  return {result: "PASS", checks: results, reset: "starter, empty history, closed output, persisted draft"};
};
