// Python editor API exposed to the card runtime as window.CodeMirror6Ready.
import {python} from "@codemirror/lang-python";
import {createEditor} from "./editor-core.mjs";

export const editorAPI = {
  createPythonEditor: options => createEditor(options, python())
};
