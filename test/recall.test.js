// test/recall.test.js — ranking behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { init, addMemory } from '../src/store.js';
import { recall } from '../src/recall.js';
import { tmpRepo } from './helpers.js';

function seed(root) {
  init(root);
  addMemory({ claim: 'auth uses HMAC proofs, never plaintext', kind: 'decision', tags: ['auth', 'security'] }, root);
  addMemory({ claim: 'we use bun as the package manager', kind: 'preference', tags: ['tooling'] }, root);
  addMemory({ claim: 'zsh startup is slow due to nvm', kind: 'gotcha', tags: ['shell'] }, root);
}

test('tag hit outranks plain text', () => {
  const root = tmpRepo();
  seed(root);
  const top = recall('auth', root)[0];
  assert.ok(top.mem.claim.includes('HMAC'));
});

test('no match → empty', () => {
  const root = tmpRepo();
  seed(root);
  assert.equal(recall('quantum chromodynamics', root).length, 0);
});

test('ranking: exact claim match beats weak overlap', () => {
  const root = tmpRepo();
  seed(root);
  const ranked = recall('bun package manager', root);
  assert.equal(ranked[0].mem.tags[0], 'tooling');
});
