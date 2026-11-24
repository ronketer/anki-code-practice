import {createRunner} from "./runner.mjs";
import {createPracticeCard} from "../shared/practice-card.mjs";
import {loadScript} from "../shared/browser.mjs";

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
