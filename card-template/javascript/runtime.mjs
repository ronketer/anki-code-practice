import {createRunner} from "./runner.mjs";
import {createPracticeCard} from "../shared/practice-card.mjs";

window.NeetCodeJavaScript = createPracticeCard({
  createRunner,
  storagePrefix: "ankicode/javascript/",
  fallbackBucket: "__neetJavaScript",
  statusId: "javascript-status",
  editorMedia: "_javascript-editor.js",
  editorReady: () => window.JavaScriptEditorReady,
  createEditor: (api, options) => api.createJavaScriptEditor(options)
});
