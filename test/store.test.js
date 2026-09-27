// test/store.test.js — storage, dedupe, retirement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { init, addMemory, loadMemories, retireMemory, isInitialized, activeMemories } from '../src/store.js';
import { createMemory } from '../src/memory.js';
import { tmpRepo } from './helpers.js';

test('init creates .memory and isInitialized flips', () => {
  const root = tmpRepo();
  assert.equal(isInitialized(root), false);
  init(root);
  assert.equal(isInitialized(root), true);
  assert.ok(fs.existsSync(path.join(root, '.memory', 'journal.jsonl')));
  assert.ok(fs.existsSync(path.join(root, '.memory', 'config.json')));
});

test('addMemory persists and dedupes exact claims', () => {
  const root = tmpRepo();
  init(root);
  const { mem } = addMemory({ claim: 'we use bun', kind: 'preference', tags: ['tooling'] }, root);
  assert.equal(mem.claim, 'we use bun');
  const second = addMemory({ claim: 'we use bun', kind: 'preference', tags: ['tooling'] }, root);
  assert.equal(second.duplicate, true);
  assert.equal(loadMemories(root).length, 1);
  // different kind counts as different memory
  const third = addMemory({ claim: 'we use bun', kind: 'fact' }, root);
  assert.equal(third.duplicate, false);
  assert.equal(loadMemories(root).length, 2);
});

test('retire keeps the record but excludes from active', () => {
  const root = tmpRepo();
  init(root);
  const { mem } = addMemory({ claim: 'old world' }, root);
  const retired = retireMemory(mem.id, 'replaced by reality', root);
  assert.equal(retired.status, 'retired');
  assert.equal(activeMemories(root).length, 0);
  const all = loadMemories(root);
  assert.equal(all.length, 1); // never silently deleted
  assert.equal(all[0].retiredReason, 'replaced by reality');
});

test('createMemory rejects empty claims and bad evidence types', () => {
  assert.throws(() => createMemory({ claim: '' }), /empty|too short/);
  assert.throws(() => createMemory({ claim: 'a reasonable claim' , evidence: [{ type: 'vibes', value: 'high' }] }), /unknown evidence type/i);
  const m = createMemory({ claim: 'a reasonable claim', evidence: ['src/a.ts', { type: 'grep', value: 'foo' }] });
  assert.equal(m.evidence[0].type, 'path');
  assert.equal(m.evidence[1].path, '.');
  assert.ok(m.id.startsWith('mem_'));
});
