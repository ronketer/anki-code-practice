(function () {
  'use strict';

  // Self-contained: serialized into a Blob worker, never executed on the UI thread.
  function pythonWorker() {
    const base = "https://cdn.jsdelivr.net/pyodide/v0.29.0/full/";
    let pyodide;
    async function initialize() {
      try {
        importScripts(base + "pyodide.js");
        pyodide = await loadPyodide({indexURL: base, stdin: () => null});
        self.postMessage({type: "ready"});
      } catch (error) {
        self.postMessage({type: "fatal", error: String(error)});
      }
    }
    self.onmessage = async ({data}) => {
      if (!pyodide) return;
      const output = [];
      let length = 0;
      let truncated = false;
      const capture = text => {
        const remaining = 64000 - length;
        if (remaining > 0) {
          const part = (text + "\n").slice(0, remaining);
          output.push(part);
          length += part.length;
        } else truncated = true;
      };
      pyodide.setStdout({batched: capture});
      pyodide.setStderr({batched: capture});
      const dict = pyodide.globals.get("dict");
      const globals = dict();
      dict.destroy();
      let result;
      let error;
      try {
        for (const key of ["mode", "code", "prompt", "testCode", "entryPoint"])
          globals.set("_anki_" + key, data[key] || "");
        // Run and Tests share the same setup, so code that runs also grades.
        // Tests call check(entry point); if the card names a method the learner
        // renamed, a Solution class with exactly one public function is used.
        const program = String.raw`
from typing import *
exec(compile(_anki_prompt, "<prompt>", "exec"), globals())
exec(compile(_anki_code, "<solution>", "exec"), globals())
_anki_passed = None
if _anki_mode == "test":
    exec(compile(_anki_testCode, "<tests>", "exec"), globals())

    def _anki_entry(expression):
        import types
        try:
            return eval(expression, globals())
        except AttributeError:
            cls = globals().get("Solution")
            own = [name for name, value in vars(cls).items()
                   if not name.startswith("_") and isinstance(value, types.FunctionType)] if isinstance(cls, type) else []
            if len(own) != 1:
                raise
            return getattr(cls(), own[0])

    _anki_passed = check(_anki_entry(_anki_entryPoint))
_anki_passed
`;
        result = await pyodide.runPythonAsync(program, {globals});
      } catch (exc) { error = String(exc); }
      finally { globals.destroy(); }
      self.postMessage({type: "result", output: output.join("") +
        (truncated ? "\n[Output truncated at 64 KB]" : ""), error,
        passed: data.mode === "test" && result === true});
      if (result && typeof result.destroy === "function") result.destroy();
    };
    initialize();
  }

  function createRunner(onState) {
    let worker = null, url = null, pending = null, timer = null, ready = false;
    function terminate(message) {
      clearTimeout(timer);
      if (worker) worker.terminate();
      if (url) URL.revokeObjectURL(url);
      worker = url = null;
      ready = false;
      const request = pending;
      pending = null;
      if (request) request.reject(new Error(message));
      onState("Python idle");
    }
    function dispatch() {
      clearTimeout(timer);
      onState("Running…");
      timer = setTimeout(() => terminate("Execution timed out. Run again to restart Python."),
        pending.payload.mode === "test" ? 10000 : 5000);
      worker.postMessage(pending.payload);
    }
    return {
      run(payload) {
        if (pending) return Promise.reject(new Error("Already running"));
        return new Promise((resolve, reject) => {
          pending = {resolve, reject, payload};
          if (ready) { dispatch(); return; }
          onState("Loading Python…");
          // First load downloads ~10 MB and compiles WebAssembly; slow machines
          // can need most of a minute. Stop stays available throughout.
          timer = setTimeout(() => terminate("Python startup timed out. Check your connection and retry."), 120000);
          try {
            url = URL.createObjectURL(new Blob(["(" + pythonWorker.toString() + ")()"],
              {type: "text/javascript"}));
            const current = worker = new Worker(url);
            current.onmessage = ({data}) => {
              if (current !== worker) return;
              if (data.type === "ready") { ready = true; dispatch(); }
              else if (data.type === "fatal") terminate("Python could not load: " + data.error);
              else if (data.type === "result" && pending) {
                clearTimeout(timer);
                const request = pending;
                pending = null;
                onState("Python ready");
                request.resolve(data);
              }
            };
            current.onerror = event => {
              event.preventDefault();
              if (current === worker) terminate(event.message || "Python worker failed. Retry Run/Tests.");
            };
            current.onmessageerror = () => terminate("Python worker communication failed. Retry Run/Tests.");
          } catch (error) { terminate("Workers unavailable: " + error.message); }
        });
      },
      stop: () => terminate("Execution stopped. Run again to restart Python."),
      destroy: () => terminate("Card closed.")
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

  window.NeetCodePro = createPracticeCard({
    createRunner,
    storagePrefix: "github.com/SimonLammer/anki-persistence/",
    fallbackBucket: "__neetCode",
    statusId: "python-status",
    editorMedia: "_codemirror6.js",
    editorReady: () => window.CodeMirror6Ready,
    createEditor: (api, options) => api.createPythonEditor(options),
    async afterEditor(isAlive) {
      // Read-only highlighting is independent of editor/runner startup.
      await loadScript("_highlight.min.js", () => !!window.hljs);
      await loadScript("_python.min.js", () => !!window.hljs.getLanguage("python"));
      if (isAlive()) document.querySelectorAll("pre code:not([data-highlighted])")
        .forEach(el => window.hljs.highlightElement(el));
    }
  });

})();
