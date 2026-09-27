// test/compile.test.js — budget, grouping, idempotency, injection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { init, addMemory } from '../src/store.js';
import { compile, renderCompiledBlock, BEGIN, END } from '../src/compile.js';
import { estimateTokens } from '../src/tokens.js';
import { tmpRepo } from './helpers.js';

test('compile emits all agent adapters and is idempotent', async () => {
  const root = tmpRepo({ files: { 'src/a.js': 'alpha beta' } });
  init(root);
  addMemory({ claim: 'module a is alpha beta', kind: 'fact', tags: ['core'], evidence: [{ type: 'path', value: 'src/a.js' }] }, root);

  const r1 = compile(root);
  assert.ok(r1.written.includes('AGENTS.md'));
  assert.ok(fs.existsSync(path.join(root, 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(root, '.cursor/rules/oliphant.mdc')));
  assert.ok(fs.existsSync(path.join(root, '.claude/skills/oliphant/SKILL.md')));

  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  // HTML comment must be closed on the BEGIN line, or the block renders invisible on GitHub
  assert.ok(agents.includes(BEGIN + ' — machine memory, do not edit by hand. Run `npx oliphant compile`. -->'));
  assert.ok(agents.includes(END));

  fs.writeFileSync(path.join(root, 'AGENTS.md'), fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'));
  const before = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  compile(root);
  const after = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.equal(before, after, 'recompiling without changes must not touch the file');
});

test('compile injects into an existing human AGENTS.md and preserves their text', () => {
  const root = tmpRepo();
  init(root);
  const human = '# AGENTS.md\n\nBe kind. Ship small PRs.\n';
  fs.writeFileSync(path.join(root, 'AGENTS.md'), human);
  addMemory({ claim: 'pr rule exists', kind: 'preference', tags: ['workflow'] }, root);
  compile(root);
  const out = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.ok(out.includes('Be kind. Ship small PRs.'));
  assert.ok(out.indexOf('Be kind') < out.indexOf(BEGIN));
});

test('token budget trims: only top-ranked memories fit', () => {
  const mems = [];
  for (let i = 0; i < 50; i++) {
    mems.push({
      id: 'mem_' + i,
      kind: 'fact',
      claim: 'fact number ' + i + ' with some padding text to burn budget quickly',
      tags: ['g' + (i % 3)],
      evidence: [],
      status: 'active',
      ts: new Date(Date.now() - i * 86_400_000).toISOString(),
      confidence: 1 - i * 0.01,
    });
  }
  const out = renderCompiledBlock(mems, { budgetTokens: 400 });
  assert.ok(estimateTokens(out.block) <= 400, `block used ${estimateTokens(out.block)} tok`);
  assert.ok(out.block.includes('fact number 0'), 'freshest memory survives');
});

test('estimator: CJK counts heavier than latin', () => {
  const latin = estimateTokens('abcdefghij'); // 10 chars → ~3
  const cjk = estimateTokens('十个汉字词条目'); // 7 CJK → 7
  assert.ok(cjk > latin);
});
