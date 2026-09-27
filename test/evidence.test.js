// test/evidence.test.js — the receipts checker against real temp dirs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifyEvidence, verifyMemory } from '../src/evidence.js';
import { tmpRepo } from './helpers.js';

test('path receipt: exists → ok, missing → fail', async () => {
  const root = tmpRepo({ files: { 'src/a.js': 'console.log(1)' } });
  const ok = await verifyEvidence(root, { type: 'path', value: 'src/a.js' });
  assert.equal(ok.ok, true);
  const miss = await verifyEvidence(root, { type: 'path', value: 'src/gone.js' });
  assert.equal(miss.ok, false);
});

test('grep receipt: finds pattern under dir; respects path scope', async () => {
  const root = tmpRepo({
    files: { 'src/a.js': 'const hmac = 1;', 'docs/x.md': 'no code here' },
  });
  const hit = await verifyEvidence(root, { type: 'grep', value: 'hmac', path: 'src' });
  assert.equal(hit.ok, true);
  const miss = await verifyEvidence(root, { type: 'grep', value: 'nonexistent_token_xyz', path: 'src' });
  assert.equal(miss.ok, false);
  const scoped = await verifyEvidence(root, { type: 'grep', value: 'const', path: 'docs' });
  assert.equal(scoped.ok, false, 'pattern exists in src but not in docs scope');
  // grep can also target a single file, not just a directory
  const fileHit = await verifyEvidence(root, { type: 'grep', value: 'hmac', path: 'src/a.js' });
  assert.equal(fileHit.ok, true);
  assert.ok(fileHit.detail.includes('a.js'), 'detail should point at the file: ' + fileHit.detail);
  const fileMiss = await verifyEvidence(root, { type: 'grep', value: 'omega', path: 'src/a.js' });
  assert.equal(fileMiss.ok, false);
});

test('grep receipt: invalid regex fails gracefully, not crash', async () => {
  const root = tmpRepo({ files: { 'src/a.js': 'x' } });
  const bad = await verifyEvidence(root, { type: 'grep', value: '([unclosed', path: 'src' });
  assert.equal(bad.ok, false);
});

test('command receipt: exit 0 vs non-zero', async () => {
  const root = tmpRepo();
  const ok = await verifyEvidence(root, { type: 'command', value: process.execPath + ' -e "process.exit(0)"' });
  assert.equal(ok.ok, true);
  const fail = await verifyEvidence(root, { type: 'command', value: process.execPath + ' -e "process.exit(3)"' });
  assert.equal(fail.ok, false);
});

test('verifyMemory: hard path failure → dead, soft grep failure → rotting', async () => {
  const root = tmpRepo({ files: { 'src/keep.js': 'alpha' } });
  const dead = await verifyMemory(root, {
    evidence: [{ type: 'path', value: 'src/gone.js' }, { type: 'grep', value: 'alpha', path: 'src' }],
  });
  assert.equal(dead.verdict, 'dead');

  const rotting = await verifyMemory(root, {
    evidence: [{ type: 'path', value: 'src/keep.js' }, { type: 'grep', value: 'missing_pattern', path: 'src' }],
  });
  assert.equal(rotting.verdict, 'rotting');

  const ok = await verifyMemory(root, {
    evidence: [{ type: 'path', value: 'src/keep.js' }, { type: 'grep', value: 'alpha', path: 'src' }],
  });
  assert.equal(ok.verdict, 'ok');
});

test('verifyMemory: skipCommands marks checks as skipped (null), never fails', async () => {
  const root = tmpRepo({ files: { 'src/a.js': 'x' } });
  const r = await verifyMemory(root, { evidence: [{ type: 'path', value: 'src/a.js' }, { type: 'command', value: 'whatever' }] }, { skipCommands: true });
  assert.equal(r.verdict, 'ok');
  const skipped = r.checks.find((c) => c.type === 'command');
  assert.equal(skipped.ok, null);
});
