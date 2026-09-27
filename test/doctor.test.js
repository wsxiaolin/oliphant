// test/doctor.test.js — verdicts, decay writes, dead-memory persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { init, addMemory, loadMemories } from '../src/store.js';
import { runDoctor } from '../src/doctor.js';
import { tmpRepo } from './helpers.js';

test('doctor: ok → active stays, verifiedAt set', async () => {
  const root = tmpRepo({ files: { 'src/a.js': 'alpha' } });
  init(root);
  addMemory({ claim: 'a exists', evidence: [{ type: 'path', value: 'src/a.js' }] }, root);
  const report = await runDoctor(root, { halfLifeDays: 30 });
  assert.equal(report.ok, 1);
  assert.equal(report.dead, 0);
  const m = loadMemories(root)[0];
  assert.ok(m.verifiedAt, 'verifiedAt stamped');
  assert.ok(m.lastScore > 0);
});

test('doctor: missing path → dead + failures++, and stays reported until retired', async () => {
  const root = tmpRepo();
  init(root);
  addMemory({ claim: 'ghost file exists', evidence: [{ type: 'path', value: 'src/gone.js' }] }, root);

  const r1 = await runDoctor(root);
  assert.equal(r1.dead, 1);
  assert.equal(loadMemories(root)[0].status, 'dead');

  // second run: the dead memory must STILL be on the bill (CI keeps failing)
  const r2 = await runDoctor(root);
  assert.equal(r2.dead, 1, 'unretired dead memory must persist in reports');
  assert.ok(r2.freshness < 1, 'dead memory drags freshness down');

  // simulate human retirement via store (forget) — then it leaves the report
  const { retireMemory } = await import('../src/store.js');
  retireMemory(loadMemories(root)[0].id, 'verified lie', root);
  const r3 = await runDoctor(root);
  assert.equal(r3.dead, 0);
});

test('doctor: grep miss → rotting, not dead', async () => {
  const root = tmpRepo({ files: { 'src/a.js': 'alpha' } });
  init(root);
  addMemory({ claim: 'alpha implies omega', evidence: [{ type: 'grep', value: 'omega', path: 'src' }] }, root);
  const report = await runDoctor(root);
  assert.equal(report.rotting, 1);
  assert.equal(report.dead, 0);
  assert.equal(loadMemories(root)[0].status, 'active');
});

test('doctor: health.json written and parseable', async () => {
  const root = tmpRepo({ files: { 'src/a.js': 'alpha' } });
  init(root);
  addMemory({ claim: 'a exists', evidence: [{ type: 'path', value: 'src/a.js' }] }, root);
  await runDoctor(root);
  const health = JSON.parse(fs.readFileSync(path.join(root, '.memory', 'health.json'), 'utf8'));
  assert.equal(health.checked, 1);
  assert.ok(health.freshness > 0);
});
