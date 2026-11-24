import {minimalSetup} from "codemirror"
import {EditorState, Compartment} from "@codemirror/state"
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter
} from "@codemirror/view"
import {indentWithTab} from "@codemirror/commands"
import {indentUnit, indentOnInput, bracketMatching} from "@codemirror/language"
import {closeBrackets, closeBracketsKeymap} from "@codemirror/autocomplete"
import {searchKeymap} from "@codemirror/search"
import {githubDark} from "@uiw/codemirror-theme-github"

export function createEditor(options, language) {
  const parent = options.parent
  const dark = !!options.dark
  const theme = new Compartment()
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {}
  const onRun = typeof options.onRun === "function" ? options.onRun : () => {}
  const onTest = typeof options.onTest === "function" ? options.onTest : () => {}

  const changeListener = EditorView.updateListener.of(update => {
    if (update.docChanged) onChange(update.state.doc.toString())
  })

  const extraKeymap = keymap.of([
    {key: "Mod-Enter", run: () => (onRun(), true)},
    {key: "Mod-Shift-Enter", run: () => (onTest(), true)},
    indentWithTab,
    ...closeBracketsKeymap,
    ...searchKeymap
  ])

  const extensions = [
    extraKeymap,
    minimalSetup,

    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),

    language,
    EditorState.tabSize.of(4),
    indentUnit.of("    "),

    theme.of(dark ? githubDark : []),
    changeListener
  ]

  const view = new EditorView({
    doc: options.doc || "",
    extensions,
    parent
  })

  function getValue() {
    return view.state.doc.toString()
  }

  function setValue(text, resetHistory) {
    const value = text == null ? "" : String(text)

    if (resetHistory) {
      // Preserve the live compartment value while replacing state to clear history.
      const currentTheme = theme.get(view.state)
      const state = EditorState.create({doc: value, extensions})
      view.setState(state.update({effects: theme.reconfigure(currentTheme)}).state)
      return
    }

    view.dispatch({
      changes: {from: 0, to: view.state.doc.length, insert: value}
    })
  }

  return {
    view,
    getValue,
    setValue,
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    setDark: dark => view.dispatch({effects: theme.reconfigure(dark ? githubDark : [])})
  }
}
