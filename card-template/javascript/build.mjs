// Build the JavaScript card's editor and runtime bundles from the editor's
// locked dependencies, and ship the same generated license notices.
import {bundleScript} from '../editor/build-tools.mjs';
import fs from 'node:fs/promises';

const here = new URL('./', import.meta.url);
for (const name of ['editor', 'runtime']) {
  await bundleScript(new URL(name + '.mjs', here), new URL('../js/_javascript-' + name + '.js', here));
}
await fs.copyFile(new URL('../editor/_cm6-LICENSES.txt', here), new URL('_javascript-LICENSES.txt', here));
console.log('Built JavaScript editor and runtime.');
