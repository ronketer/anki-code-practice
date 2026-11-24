import {pythonWorker} from "./worker.mjs";

export function createRunner(onState) {
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
