export function javascriptWorker() {
  self.onmessage = async ({data}) => {
    let output = '', truncated = false;
    const format = value => {
      if (typeof value === 'string') return value;
      if (typeof value === 'bigint') return String(value) + 'n';
      try { return JSON.stringify(value, (_, x) => typeof x === 'bigint' ? String(x) + 'n' : x) ?? String(value); }
      catch (_) { return String(value); }
    };
    const capture = (...values) => {
      const text = values.map(format).join(' ') + '\n';
      const remaining = Math.max(0, 64000 - output.length);
      output += text.slice(0, remaining);
      truncated ||= text.length > remaining;
    };
    for (const name of ['log', 'info', 'warn', 'error', 'debug']) console[name] = capture;
    try {
      const result = await new Function('"use strict";\n' + (data.prompt || '') + '\n' + data.code + '\n' +
        (data.mode === 'test' ? data.testCode : '') + '\n//# sourceURL=practice-solution.js')();
      self.postMessage({output: output + (truncated ? '\n[Output truncated at 64,000 characters]\n' : ''),
        passed: data.mode === 'test' ? result === true : null});
    } catch (error) {
      self.postMessage({output, error: String(error.stack || error).slice(0, 16000)});
    }
  };
}
