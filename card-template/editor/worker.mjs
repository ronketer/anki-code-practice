// Self-contained: serialized into a Blob worker, never executed on the UI thread.
export function pythonWorker() {
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
