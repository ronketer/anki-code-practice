// Resolve all editor bundles from the same locked CM6 dependency graph.
import {rollup} from 'rollup';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import {fileURLToPath} from 'node:url';

// @babel/runtime is a direct dependency because @uiw/codemirror-theme-github
// imports its helpers without declaring it. Unresolved imports would silently
// become undefined globals in the bundle, so they fail the build instead.
export function failOnUnresolved(warning, warn) {
  if (warning.code === 'UNRESOLVED_IMPORT') throw new Error(warning.message);
  warn(warning);
}

export function browserResolver() {
  return nodeResolve({
    browser: true,
    modulePaths: [fileURLToPath(new URL('node_modules', import.meta.url))],
    dedupe: id => id.startsWith('@codemirror/') || id.startsWith('@lezer/')
  });
}

export async function bundleScript(input, output) {
  const bundle = await rollup({input: fileURLToPath(input), plugins: [browserResolver()], onwarn: failOnUnresolved});
  try {
    await bundle.write({file: fileURLToPath(output), format: 'iife'});
  } finally {
    await bundle.close();
  }
}

export async function bundleSource(input) {
  const bundle = await rollup({input: fileURLToPath(input), onwarn: failOnUnresolved});
  try {
    const {output} = await bundle.generate({format: 'iife'});
    return output[0].code;
  } finally {
    await bundle.close();
  }
}
