// test/memory.test.js — decay math and validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decayScore, healthLabel, validateMemory, KINDS } from '../src/memory.js';

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

test('decayScore: fresh memory scores around its confidence', () => {
  const m = { ts: iso(0), confidence: 0.8 };
  const s = decayScore(m);
  assert.ok(s > 0.75 && s <= 1, `got ${s}`);
});

test('decayScore: half-life halves the score every ~30 days', () => {
  const m = { ts: iso(30), confidence: 1.0, verifications: 0, failures: 0 };
  const s = decayScore(m, { halfLifeDays: 30 });
  assert.ok(Math.abs(s - 0.5) < 0.02, `got ${s}`);
  const m60 = { ts: iso(60), confidence: 1.0, verifications: 0, failures: 0 };
  const s60 = decayScore(m60, { halfLifeDays: 30 });
  assert.ok(Math.abs(s60 - 0.25) < 0.02, `got ${s60}`);
});

test('decayScore: failures subtract, verification history adds', () => {
  const base = { ts: iso(0), confidence: 0.8 };
  const withFail = decayScore({ ...base, failures: 2 });
  const plain = decayScore(base);
  assert.ok(withFail < plain);
  const withHist = decayScore({ ...base, verifications: 6 });
  assert.ok(withHist > plain);
});

test('decayScore never escapes [0,1]', () => {
  const s = decayScore({ ts: iso(365), confidence: 1.0, failures: 99, verifications: 99 });
  assert.ok(s >= 0 && s <= 1);
});

test('healthLabel buckets', () => {
  assert.equal(healthLabel(0.9).label, 'fresh');
  assert.equal(healthLabel(0.5).label, 'aging');
  assert.equal(healthLabel(0.3).label, 'rotting');
  assert.equal(healthLabel(0.1).label, 'rot');
});

test('validateMemory catches broken records', () => {
  const good = { id: 'mem_x', claim: 'c', kind: 'fact', status: 'active', evidence: [] };
  assert.deepEqual(validateMemory(good), []);
  const bad = { id: '', claim: '', kind: 'nope', status: 'nope' };
  assert.ok(validateMemory(bad).length >= 4);
  assert.ok(KINDS.length >= 5);
});
