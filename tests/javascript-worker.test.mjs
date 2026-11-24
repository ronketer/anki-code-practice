// Run the JavaScript card worker in Node with a fake Worker global.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {javascriptWorker} from '../card-template/javascript/worker.mjs';

async function run(data) {
  const saved = {...console};
  let message;
  globalThis.self = {postMessage: value => { message = value; }};
  try {
    javascriptWorker();
    await self.onmessage({data});
  } finally {
    Object.assign(console, saved);
    delete globalThis.self;
  }
  return message;
}

test('run mode captures console output and never reports a pass', async () => {
  const result = await run({mode: 'run', code: 'console.log("hi", {a: 1n}); console.error(2);'});
  assert.equal(result.output, 'hi {"a":"1n"}\n2\n');
  assert.equal(result.passed, null);
});

test('test mode returns the harness result and runs the prompt first', async () => {
  const data = {mode: 'test', prompt: 'const twice = x => 2 * x;', code: 'const solve = x => twice(x);'};
  assert.equal((await run({...data, testCode: 'return solve(2) === 4;'})).passed, true);
  assert.equal((await run({...data, testCode: 'return solve(2) === 5;'})).passed, false);
  assert.equal((await run({...data, mode: 'run', testCode: 'throw Error("tests ran")'})).error, undefined);
});

test('errors keep earlier output and include the stack', async () => {
  const result = await run({mode: 'run', code: 'console.log("before"); null.x;'});
  assert.equal(result.output, 'before\n');
  assert.match(result.error, /TypeError/);
  assert.match(result.error, /practice-solution\.js/);
});

test('output is capped at 64,000 characters', async () => {
  const result = await run({mode: 'run', code: 'for (let i = 0; i < 2000; i++) console.log("x".repeat(100));'});
  assert.ok(result.output.length < 64100);
  assert.match(result.output, /\[Output truncated at 64,000 characters\]/);
});
