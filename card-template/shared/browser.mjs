// Small browser/WebView mechanics. Card identity, UI and execution stay with callers.
const scripts = new Map();

export function loadScript(src, ready) {
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

export function createDraftStore({root, starter, storageKey, fallbackBucket, itemKey}) {
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
export function observeCardRoot(root, {onDetach, onPageHide, onThemeChange}) {
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
