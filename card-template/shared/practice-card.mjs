import {loadScript, createDraftStore, observeCardRoot} from "./browser.mjs";

// Execution stays behind the injected runner's run/stop/destroy protocol.
export function createPracticeCard({createRunner, storagePrefix, fallbackBucket,
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
