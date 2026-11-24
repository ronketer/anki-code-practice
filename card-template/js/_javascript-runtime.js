(function () {
  'use strict';

  function javascriptWorker() {
    self.onmessage = async ({data}) => {
      let output = '', truncated = false;
      const format = value => {
        if (typeof value === 'string') return value;
        if (typeof value === 'bigint') return String(value) + 'n';
        try { return JSON.stringify(value, (_, x) => typeof x === 'bigint' ? String(x) + 'n' : x) ?? String(value); }
        catch (_) { return String(value); }
      };
      const capture = (...values) => {
        const text = values.map(format).join(' ') + '\n';
        const remaining = Math.max(0, 64000 - output.length);
        output += text.slice(0, remaining);
        truncated ||= text.length > remaining;
      };
      for (const name of ['log', 'info', 'warn', 'error', 'debug']) console[name] = capture;
      try {
        const result = await new Function('"use strict";\n' + (data.prompt || '') + '\n' + data.code + '\n' +
          (data.mode === 'test' ? data.testCode : '') + '\n//# sourceURL=practice-solution.js')();
        self.postMessage({output: output + (truncated ? '\n[Output truncated at 64,000 characters]\n' : ''),
          passed: data.mode === 'test' ? result === true : null});
      } catch (error) {
        self.postMessage({output, error: String(error.stack || error).slice(0, 16000)});
      }
    };
  }

  function createRunner(onState, limits = {run: 5000, test: 10000}) {
    let active = null;
    function finish(request, error, result) {
      if (active !== request) return;
      active = null;
      clearTimeout(request.timer);
      request.worker?.terminate();
      if (request.url) URL.revokeObjectURL(request.url);
      onState('JavaScript idle');
      if (error) request.reject(new Error(error));
      else request.resolve(result);
    }
    return {
      run(payload) {
        if (active) return Promise.reject(new Error('Already running'));
        return new Promise((resolve, reject) => {
          const request = active = {resolve, reject};
          onState('Running…');
          try {
            request.url = URL.createObjectURL(new Blob(['(' + javascriptWorker.toString() + ')()'], {type: 'text/javascript'}));
            request.worker = new Worker(request.url);
            request.worker.onmessage = ({data}) => finish(request, null, data);
            request.worker.onerror = event => { event.preventDefault(); finish(request, event.message || 'JavaScript worker failed.'); };
            request.worker.onmessageerror = () => finish(request, 'JavaScript worker communication failed.');
            request.timer = setTimeout(() => finish(request, 'Execution timed out. Run again to restart JavaScript.'), limits[payload.mode]);
            request.worker.postMessage(payload);
          } catch (error) { finish(request, 'Workers unavailable: ' + error.message); }
        });
      },
      stop() { if (active) finish(active, 'Execution stopped.'); },
      destroy() { if (active) finish(active, 'Card closed.'); }
    };
  }

  // Small browser/WebView mechanics. Card identity, UI and execution stay with callers.
  const scripts = new Map();

  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    if (!scripts.has(src)) scripts.set(src, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => { scripts.delete(src); script.remove(); reject(new Error("Could not load " + src)); };
      document.head.appendChild(script);
    }));
    return scripts.get(src);
  }

  function createDraftStore({root, starter, storageKey, fallbackBucket, itemKey}) {
    const memory = window.py || window.qt || window;
    memory[fallbackBucket] = memory[fallbackBucket] || {};
    const store = {
      write(value) {
        memory[fallbackBucket][itemKey] = value;
        try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch (_) { /* WebView fallback */ }
      },
      read(defaultValue) {
        try {
          const value = JSON.parse(sessionStorage.getItem(storageKey));
          if (typeof value === "string") return value;
        } catch (_) { /* WebView fallback */ }
        return memory[fallbackBucket][itemKey] ?? defaultValue;
      }
    };
    // A new question root is a new encounter. Remounting that same root (e.g.
    // after a failed editor load) is not. The answer template explicitly wraps
    // FrontSide so its bootstrap cannot mistake answer rendering for a question.
    // Initialize before awaiting assets, and after the previous card is destroyed.
    if (!root.__ankiCodeDraftInitialized) {
      // The bootstrap captures the question even before the runtime loads. If
      // Show Answer wins that race, discard any earlier encounter's stored draft.
      const question = root.__ankiCodeQuestionRoot;
      if (!root.closest('[data-ankicode-side="answer"]') ||
          (question && !question.__ankiCodeDraftInitialized)) store.write(starter);
      if (question) question.__ankiCodeDraftInitialized = true;
      root.__ankiCodeDraftInitialized = true;
    }
    return store;
  }

  // Anki reuses its reviewer WebView. Observe detachment and live night-mode changes;
  // the caller owns idempotent destruction and disconnects this subscription.
  function observeCardRoot(root, {onDetach, onPageHide, onThemeChange}) {
    const isDark = () => !!root.closest(".nightMode, .night_mode, .night-mode");
    let dark = isDark();
    const observer = new MutationObserver(() => {
      if (!root.isConnected) { onDetach(); return; }
      const next = isDark();
      if (next !== dark) { dark = next; onThemeChange(dark); }
    });
    window.addEventListener("pagehide", onPageHide);
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["class"]
    });
    return {
      get dark() { return dark; },
      disconnect() {
        observer.disconnect();
        window.removeEventListener("pagehide", onPageHide);
      }
    };
  }

  // Execution stays behind the injected runner's run/stop/destroy protocol.
  function createPracticeCard({createRunner, storagePrefix, fallbackBucket,
    statusId, editorMedia, editorReady, createEditor, afterEditor}) {
    return {async mount(root) {
      if (!root.isConnected) return;
      if (window.AnkiCodeCard) window.AnkiCodeCard.destroy();
      let editor, disposed = false, busy = false, lifecycle;
      const byId = id => root.querySelector("#" + id);
      const field = name => byId("field-" + name).value;
      const starter = field("code-snippets"), slug = field("title-slug");
      // Preserve intentionally empty code through the answer-side remount.
      const drafts = createDraftStore({
        root, starter,
        storageKey: storagePrefix + slug,
        fallbackBucket, itemKey: slug
      });
      function output(text, kind = "") {
        byId("output-window").textContent = text;
        byId("output-window").className = kind;
        byId("output-panel").open = true;
      }
      function controls() {
        byId("run-button").disabled = !editor || busy;
        byId("test-button").disabled = !editor || busy;
        byId("stop-button").disabled = !busy;
        byId("reset-button").disabled = !editor || busy;
      }
      const runner = createRunner(state => { if (!disposed) byId(statusId).textContent = state; });
      async function execute(mode) {
        if (!editor || busy || disposed) return;
        if (mode === "test" && (!field("test-code").trim() || !field("entry-point").trim())) {
          output("No generated tests are available for this problem. Use Run with your own examples.");
          return;
        }
        busy = true;
        controls();
        output("");
        try {
          const result = await runner.run({mode, code: editor.getValue(), prompt: field("prompt"),
            testCode: field("test-code"), entryPoint: field("entry-point")});
          if (disposed) return;
          output(result.output + (result.error || "") || "Finished with no output.",
            result.error ? "error" : mode === "test" ? result.passed ? "success" : "error" : "");
        } catch (error) { if (!disposed) output(error.message, "error"); }
        finally { busy = false; if (!disposed) controls(); }
      }
      function destroy() {
        if (disposed) return;
        disposed = true;
        if (editor) { drafts.write(editor.getValue()); editor.destroy(); }
        runner.destroy();
        lifecycle?.disconnect();
      }
      const card = window.AnkiCodeCard = {destroy, get editor() { return editor; }};
      byId("run-button").onclick = () => execute("run");
      byId("test-button").onclick = () => execute("test");
      byId("stop-button").onclick = () => runner.stop();
      byId("reset-button").onclick = () => {
        if (!editor || busy) return;
        editor.setValue(starter, true);
        drafts.write(starter);
        byId("output-window").textContent = "";
        byId("output-panel").open = false;
        editor.focus();
      };
      byId("show-tags").onclick = () => {
        try {
          for (const [slug, label] of Object.entries(JSON.parse(field("topic-tags")))) {
            const a = document.createElement("a");
            a.textContent = label;
            a.href = "https://leetcode.com/tag/" + encodeURIComponent(slug) + "/";
            byId("tags").appendChild(a);
          }
          byId("show-tags").hidden = true;
        } catch (_) { output("Topic tags could not be read.", "error"); }
      };
      lifecycle = observeCardRoot(root, {
        onDetach: destroy, onPageHide: destroy,
        onThemeChange: dark => editor?.setDark(dark)
      });
      try {
        await loadScript(editorMedia, () => !!editorReady());
        const cm6 = await editorReady();
        if (disposed || !root.isConnected || window.AnkiCodeCard !== card) return;
        editor = createEditor(cm6, {parent: byId("code-window"), doc: drafts.read(starter), dark: lifecycle.dark,
          onChange: drafts.write, onRun: () => execute("run"), onTest: () => execute("test")});
        controls();
        if (afterEditor) await afterEditor(() => !disposed);
      } catch (error) { if (!disposed) output(error.message, "error"); }
    }};
  }

  window.NeetCodeJavaScript = createPracticeCard({
    createRunner,
    storagePrefix: "ankicode/javascript/",
    fallbackBucket: "__neetJavaScript",
    statusId: "javascript-status",
    editorMedia: "_javascript-editor.js",
    editorReady: () => window.JavaScriptEditorReady,
    createEditor: (api, options) => api.createJavaScriptEditor(options)
  });

})();
