import {editorAPI} from "./editor-api.mjs";

// Python editor bundle (_codemirror6.js). The media name stays stable so existing decks keep working.
window.CodeMirror6Ready = Promise.resolve(editorAPI);
