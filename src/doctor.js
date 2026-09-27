// doctor.js — the flagship. Re-verifies every active memory against the live
// repo, decays what rots, proposes retirement for what is dead, and writes
// .memory/health.json for CI and badges.
import path from 'node:path';
import { verifyMemory, summarizeChecks } from './evidence.js';
import { decayScore, healthLabel } from './memory.js';
import { loadMemories, saveMemories, updateMemory, commit, memoryDir } from './store.js';
import { writeJson, nowIso, c } from './util.js';

export async function runDoctor(root, { halfLifeDays = 30, skipCommands = false, json = false } = {}) {
  const mems = loadMemories(root);
  const active = mems.filter((m) => m.status === 'active');
  const results = [];

  for (const mem of active) {
    const { verdict, checks } = await verifyMemory(root, mem, { skipCommands });
    const score = decayScore(mem, { halfLifeDays });

    let next = { id: mem.id, verdict, score, checks };
    if (verdict === 'dead') {
      // A hard receipt failed. Memory is presumed lying. Needs human (or CI) sign-off.
      await updateMemory(mem.id, { status: 'dead', deadAt: nowIso(), failures: (mem.failures ?? 0) + 1, lastVerdict: verdict, lastScore: score }, root);
      next.action = 'retire (run: oliphant forget ' + mem.id + ')';
    } else if (verdict === 'rotting') {
      await updateMemory(mem.id, { verifiedAt: mem.verifiedAt ?? mem.ts, lastVerdict: verdict, lastScore: score, failures: (mem.failures ?? 0) + 1 }, root);
      next.action = 'review receipts';
    } else {
      await updateMemory(mem.id, { verifiedAt: nowIso(), verifications: (mem.verifications ?? 0) + 1, lastVerdict: verdict, lastScore: score }, root);
      next.action = null;
    }
    results.push(next);
  }

  await commit({ type: 'doctor.run', checked: results.length, dead: results.filter((r) => r.verdict === 'dead').length }, root);

  // Dead memories never silently disappear: unretired 'dead' records stay in
  // every future report until a human runs `oliphant forget <id>`. Otherwise
  // a lie could be committed once and forgotten by CI forever.
  const after = loadMemories(root);
  const unretired = after.filter((m) => m.status === 'active' || m.status === 'dead');
  const deadCount =
    results.filter((r) => r.verdict === 'dead').length +
    after.filter((m) => m.status === 'dead' && !results.some((r) => r.id === m.id)).length;
  const scores = unretired.map((m) => (m.status === 'dead' ? 0 : (m.lastScore ?? decayScore(m, { halfLifeDays }))));
  const freshness = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 1;

  const report = {
    at: nowIso(),
    checked: results.length,
    ok: results.filter((r) => r.verdict === 'ok').length,
    rotting: results.filter((r) => r.verdict === 'rotting').length,
    dead: deadCount,
    skipped: results.filter((r) => r.checks.every((ch) => ch.ok === null)).length,
    freshness: Math.round(freshness * 100) / 100,
    results,
  };
  writeJson(path.join(memoryDir(root), 'health.json'), report);
  return report;
}

function freshnessBar(v) {
  const n = Math.round(v * 10);
  return '[' + '█'.repeat(n) + '░'.repeat(10 - n) + ']';
}

/** Human table with claims — used by CLI (rich mode). */
export function renderDoctorDetailed(report, mems) {
  const line = c.dim('─'.repeat(64));
  console.log(line);
  console.log(c.bold('🩺 oliphant doctor'));
  console.log(line);
  const byId = new Map(mems.map((m) => [m.id, m]));
  const shown = new Set();
  for (const r of report.results) {
    const m = byId.get(r.id);
    if (!m) continue;
    shown.add(r.id);
    const badge = r.verdict === 'ok' ? c.green('✓ ok') : r.verdict === 'rotting' ? c.yellow('◐ rotting') : c.red('✗ dead');
    console.log(`${badge}  ${c.dim(r.score.toFixed(2))}  ${m.kind}: ${m.claim}`);
    for (const l of summarizeChecks(r.checks)) console.log('      ' + c.dim(l));
    if (r.action) console.log('      → ' + c.yellow(r.action));
  }
  // Unretired dead memories from earlier runs stay on the bill until a human forgets them.
  for (const m of mems) {
    if (m.status === 'dead' && !shown.has(m.id)) {
      console.log(`${c.red('✗ dead')}  ${c.dim('0.00')}  ${m.kind}: ${m.claim}`);
      console.log('      ' + c.dim('awaiting retirement since ' + (m.deadAt ?? m.ts)));
      console.log('      → ' + c.yellow('retire (run: oliphant forget ' + m.id + ')'));
    }
  }
  console.log(line);
  if (report.checked === 0) console.log('  nothing to verify yet — ' + c.cyan('oliphant remember "..."') + ' to add memory');
  console.log('  freshness ' + freshnessBar(report.freshness) + ' ' + Math.round(report.freshness * 100) + '%   (ok ' + report.ok + ' / rotting ' + report.rotting + ' / dead ' + report.dead + ')');
  console.log(line);
}
