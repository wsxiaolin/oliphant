// stats.js — one glance: how big, how fresh, how alive is the memory.
import path from 'node:path';
import { loadMemories, journal, memoryDir } from './store.js';
import { decayScore, healthLabel } from './memory.js';
import { readJson } from './util.js';
import { c } from './util.js';

export function computeStats(cwd = process.cwd()) {
  const mems = loadMemories(cwd);
  const active = mems.filter((m) => m.status === 'active');
  const byKind = {};
  const byStatus = {};
  const tags = {};
  for (const m of mems) {
    byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
    byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
    for (const t of m.tags ?? []) tags[t] = (tags[t] ?? 0) + 1;
  }
  const scores = active.map((m) => m.lastScore ?? decayScore(m));
  const freshness = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 1;
  const compiled = readJson(path.join(memoryDir(cwd), 'compiled.json'), null);
  const health = readJson(path.join(memoryDir(cwd), 'health.json'), null);
  const events = journal(cwd);
  return {
    total: mems.length,
    active: active.length,
    byKind,
    byStatus,
    topTags: Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 8),
    freshness: Math.round(freshness * 100) / 100,
    compiledTokens: compiled?.tokens ?? null,
    lastDoctor: health?.at ?? null,
    journalEvents: events.length,
  };
}

export function renderStats(s) {
  const line = c.dim('─'.repeat(48));
  console.log(line);
  console.log(c.bold('📊 oliphant stats'));
  console.log(line);
  const h = healthLabel(s.freshness);
  console.log(`  memories: ${s.active} active / ${s.total} total   freshness: ${h.emoji} ${Math.round(s.freshness * 100)}%`);
  console.log(`  by kind:  ${Object.entries(s.byKind).map(([k, v]) => `${k}=${v}`).join('  ') || '—'}`);
  console.log(`  by state: ${Object.entries(s.byStatus).map(([k, v]) => `${k}=${v}`).join('  ') || '—'}`);
  if (s.topTags.length) console.log(`  top tags: ${s.topTags.map(([t, n]) => `${t}(${n})`).join('  ')}`);
  console.log(`  compiled block: ${s.compiledTokens ?? '—'} tok   journal events: ${s.journalEvents}`);
  console.log(`  last doctor: ${s.lastDoctor ? new Date(s.lastDoctor).toLocaleString() : 'never — run oliphant doctor'}`);
  console.log(line);
}
