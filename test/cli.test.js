// test/cli.test.js — end-to-end via the real binary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { tmpRepo, runCli } from './helpers.js';

test('cli e2e: init → remember → compile → doctor → stats → forget', async () => {
  const root = tmpRepo({ files: { 'src/auth.js': 'const hmac = 1' } });

  const r0 = await runCli(['init'], root);
  assert.equal(r0.code, 0, r0.stderr);
  assert.ok(fs.existsSync(path.join(root, '.memory')));

  const r1 = await runCli(
    ['remember', 'auth uses hmac', '--kind', 'decision', '--tag', 'auth', '--evidence', 'path:src/auth.js'],
    root
  );
  assert.equal(r1.code, 0, r1.stderr);
  assert.match(r1.stdout, /remembered mem_/);

  const r2 = await runCli(['compile'], root);
  assert.equal(r2.code, 0, r2.stderr);
  assert.ok(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').includes('auth uses hmac'));

  const r3 = await runCli(['doctor', '--skip-commands'], root);
  assert.equal(r3.code, 0, r3.stderr);
  assert.match(r3.stdout, /freshness/);

  const r4 = await runCli(['stats'], root);
  assert.match(r4.stdout, /memories: 1 active/);

  // break reality → doctor --ci must fail
  fs.rmSync(path.join(root, 'src'), { recursive: true });
  const r5 = await runCli(['doctor', '--ci'], root);
  assert.equal(r5.code, 1, 'CI must fail on dead memory');
  assert.match(r5.stdout, /dead memories found|✗ dead/);

  // human verdict: forget the lie → CI green
  const mems = JSON.parse(fs.readFileSync(path.join(root, '.memory', 'memories.json'), 'utf8'));
  const r6 = await runCli(['forget', mems[0].id], root);
  assert.equal(r6.code, 0, r6.stderr);
  const r7 = await runCli(['doctor', '--ci'], root);
  assert.equal(r7.code, 0, 'after forget, CI must pass');
});

test('cli: commands refuse to run before init', async () => {
  const root = tmpRepo();
  const r = await runCli(['remember', 'x'], root);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not initialized/);
});

test('cli: ls shows memories with status glyphs', async () => {
  const root = tmpRepo();
  await runCli(['init'], root);
  await runCli(['remember', 'note one', '--kind', 'fact'], root);
  const r = await runCli(['ls'], root);
  assert.match(r.stdout, /●/);
  assert.match(r.stdout, /note one/);
});
