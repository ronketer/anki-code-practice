// JavaScript card in restricted WebViews: storage fallbacks, cleanup and editor load retry.
module.exports = async (page, base = 'http://127.0.0.1:8879/') => {
  const results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const open = async () => {
    await page.goto(base + "javascript-front.html");
    await page.waitForFunction(() => window.AnkiCodeCard?.editor);
  };

  // Storage-denied WebViews must retain even empty drafts across remounts.
  for (const host of ["py", "qt", "window"]) {
    await open();
    const result = await page.evaluate(async host => {
      window.AnkiCodeCard.destroy();
      delete window.py;
      delete window.qt;
      if (host !== "window") window[host] = {};
      Object.defineProperty(window, "sessionStorage", {
        configurable: true, get() { throw new Error("Storage unavailable"); }
      });
      const root = document.querySelector("#neet-pro");
      await window.NeetCodeJavaScript.mount(root);
      window.AnkiCodeCard.editor.setValue("");
      const memory = host === "window" ? window : window[host];
      const stored = memory.__neetJavaScript["ankicode-demo-meter-deltas"];
      await window.NeetCodeJavaScript.mount(root);
      const restored = window.AnkiCodeCard.editor.getValue();
      window.dispatchEvent(new Event("pagehide"));
      const removed = !root.querySelector(".cm-editor");
      window.AnkiCodeCard.destroy(); // repeated cleanup is harmless
      return {stored, restored, removed};
    }, host);
    assert(result.stored === "" && result.restored === "" && result.removed,
      host + ": fallback draft/pagehide cleanup failed");
    results.push(host + " fallback: empty draft, remount, pagehide, repeated cleanup");
  }

  // Failed editor loads can retry in the same WebView.
  await page.route("**/_javascript-editor.js", route => route.abort());
  await page.goto(base + "javascript-front.html");
  await page.waitForFunction(() => document.querySelector("#output-window").textContent.includes("Could not load"));
  await page.unroute("**/_javascript-editor.js");
  await page.evaluate(() => window.NeetCodeJavaScript.mount(document.querySelector("#neet-pro")));
  assert(await page.locator(".cm-editor").count() === 1, "Editor load retry failed");
  results.push("Failed editor load retries in the same WebView");

  // Two mounts await one script; only the connected card may create an editor.
  let held;
  let requests = 0;
  await page.route("**/_javascript-editor.js", route => { held = route; requests++; });
  try {
    await page.goto(base + "javascript-front.html", {waitUntil: "domcontentloaded"});
    await page.waitForFunction(() => !!window.NeetCodeJavaScript);
    await page.evaluate(async () => {
      const html = await (await fetch("javascript-front.html")).text();
      const next = new DOMParser().parseFromString(html, "text/html").querySelector("#neet-pro");
      document.querySelector("#neet-pro").replaceWith(next);
      document.body.className = "card night_mode";
      window.NeetCodeJavaScript.mount(next);
    });
    assert(held, "Editor request was not intercepted");
    await held.continue();
    await page.waitForFunction(() => window.AnkiCodeCard?.editor);
    assert(requests === 1 && await page.locator(".cm-editor").count() === 1,
      "Concurrent mounts duplicated the script or editor");
    assert(await page.locator(".cm-editor").evaluate(el => getComputedStyle(el).color) === "rgb(201, 209, 217)",
      "Theme change during editor loading was lost");
  } finally {
    await page.unroute("**/_javascript-editor.js");
  }
  results.push("Pending editor load: one script, detached mount ignored, latest theme applied");

  // Observe actual worker termination and Blob revocation on root removal alone.
  await open();
  await page.evaluate(() => {
    window.cleanupCounts = {terminated: 0, revoked: 0};
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      terminate() { window.cleanupCounts.terminated++; super.terminate(); }
    };
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { window.cleanupCounts.revoked++; revoke(url); };
    window.AnkiCodeCard.editor.setValue("while(true){}");
  });
  await page.click("#run-button");
  await page.waitForFunction(() => document.querySelector("#javascript-status").textContent === "Running…", null, {timeout: 65000});
  await page.evaluate(() => document.querySelector("#neet-pro").remove());
  await page.waitForFunction(() => window.cleanupCounts.terminated === 1 && window.cleanupCounts.revoked === 1);
  results.push("Root removal terminates the running worker and revokes its Blob URL");
  return {result: "PASS", results};
};
