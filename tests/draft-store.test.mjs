import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDraftStore} from '../card-template/shared/browser.mjs';

for (const host of ['sessionStorage', 'py', 'qt', 'window']) {
  test(`encounter drafts with ${host}`, () => {
    globalThis.window = host === 'py' || host === 'qt' ? {[host]: {}} : {};
    const saved = new Map();
    globalThis.sessionStorage = {
      getItem(key) { if (host !== 'sessionStorage') throw Error('denied'); return saved.get(key) ?? null; },
      setItem(key, value) { if (host !== 'sessionStorage') throw Error('denied'); saved.set(key, value); }
    };
    for (const [storageKey, fallbackBucket] of [['python:1', '__neetCode'], ['javascript:1', '__neetCodeJavaScript']]) {
      const starter = 'starter';
      const root = (answer = false) => ({closest: () => answer ? {} : null});
      const store = root => createDraftStore({root, starter, storageKey, fallbackBucket, itemKey: '1'});
      store(root()).write('stale previous review');
      const question = root(), draft = store(question);
      assert.equal(draft.read(starter), starter);
      draft.write('attempt');
      assert.equal(store(question).read(starter), 'attempt', 'same-root remount');
      assert.equal(store(root(true)).read(starter), 'attempt', 'Show Answer');
      assert.equal(store(root()).read(starter), starter, 'later review');
      const resetRoot = root(), reset = store(resetRoot);
      reset.write('changed'); reset.write(starter);
      assert.equal(store(resetRoot).read(starter), starter);
      assert.equal(store(root(true)).read(starter), starter, 'Reset then answer');
      reset.write('');
      assert.equal(store(root(true)).read(starter), '', 'empty attempt');
      assert.equal(store(root()).read(starter), starter, 'empty attempt next review');
      reset.write('stale before runtime load');
      const earlyAnswer = root(true);
      earlyAnswer.__ankiCodeQuestionRoot = root(); // question never mounted
      assert.equal(store(earlyAnswer).read(starter), starter, 'answer before question runtime loads');
      store(earlyAnswer).write('early answer edit');
      const nextAnswer = root(true);
      nextAnswer.__ankiCodeQuestionRoot = earlyAnswer.__ankiCodeQuestionRoot;
      assert.equal(store(nextAnswer).read(starter), 'early answer edit', 'early answer remount');
    }
    delete globalThis.window;
    delete globalThis.sessionStorage;
  });
}
