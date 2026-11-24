import {javascript} from "@codemirror/lang-javascript";
import {createEditor} from "../editor/editor-core.mjs";

window.JavaScriptEditorReady = Promise.resolve({
  createJavaScriptEditor: options => createEditor(options, javascript())
});
