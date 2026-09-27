// recall.js — keyword search over memory. Simple, transparent, deterministic.
// (No embeddings. Memory that fits in a repo doesn't need a vector DB.)
import { activeMemories } from './store.js';
import { decayScore } from './memory.js';

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'we', 'use', 'using', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'it', 'that', 'this', 'with', 'not']);

function tokenize(q) {
  return String(q)
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((t) => t && !STOP.has(t));
}

export function scoreMemory(mem, queryTokens) {
  const claim = mem.claim.toLowerCase();
  const tags = new Set(mem.tags ?? []);
  let s = 0;
  for (const t of queryTokens) {
    if (tags.has(t)) s += 3; // exact tag hit
    if (claim.includes(t)) s += 2; // claim contains term
    // partial word match in claim (>=4 char stems)
    if (t.length >= 4 && claim.includes(t.slice(0, Math.max(4, Math.floor(t.length * 0.75))))) s += 1;
  }
  return s;
}

export function recall(query, cwd = process.cwd(), { limit = 5 } = {}) {
  const tokens = tokenize(query);
  const mems = activeMemories(cwd);
  const scored = mems
    .map((m) => ({
      mem: m,
      score: scoreMemory(m, tokens) + decayScore(m) * 0.5, // fresher memory wins ties
    }))
    .filter((r) => r.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}

export function renderRecall(results) {
  if (!results.length) return 'no matching memory. add one: oliphant remember "..." --tag ...';
  return results
    .map(({ mem }) => {
      const receipts = (mem.evidence ?? []).map((e) => (e.type === 'grep' ? `${e.type}:${e.value}${e.path && e.path !== '.' ? '@' + e.path : ''}` : `${e.type}:${e.value}`)).join(', ');
      return `[${mem.kind}] ${mem.claim}${receipts ? `\n    receipts: ${receipts}` : ''}`;
    })
    .join('\n');
}
