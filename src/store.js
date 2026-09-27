// store.js — event-sourced storage inside the repo.
//
//   .memory/
//     journal.jsonl     ← append-only audit log (the source of truth)
//     memories.json     ← materialized view (fast reads)
//     health.json       ← last doctor run (verdicts + freshness)
//     config.json       ← user config
//
// Both files live IN THE REPO, so memory is versioned, reviewable in PRs,
// and shared by the whole team. No cloud. No daemon. No vector DB.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, appendJsonl, readJsonl, nowIso } from './util.js';
import { validateMemory, createMemory } from './memory.js';

export const MEMORY_DIR = '.memory';

export function memoryDir(cwd = process.cwd()) {
  return path.join(cwd, MEMORY_DIR);
}

export function isInitialized(cwd = process.cwd()) {
  return fs.existsSync(path.join(memoryDir(cwd), 'memories.json'));
}

export function defaultConfig() {
  return {
    version: 1,
    budgetTokens: 2000,
    halfLifeDays: 30,
    emit: { agents: true, claude: true, cursor: true, skill: true },
    ci: { minFreshness: 0.75, failOn: 'dead' },
  };
}

export function loadConfig(cwd = process.cwd()) {
  const cfg = readJson(path.join(memoryDir(cwd), 'config.json'), null);
  return cfg ? { ...defaultConfig(), ...cfg, emit: { ...defaultConfig().emit, ...(cfg.emit ?? {}) }, ci: { ...defaultConfig().ci, ...(cfg.ci ?? {}) } } : defaultConfig();
}

export function requireInit(cwd = process.cwd()) {
  if (!isInitialized(cwd)) {
    throw new Error('not initialized here — run `oliphant init` first');
  }
}

/** Scaffold .memory/ in the repo. Idempotent. Returns the memory dir. */
export function init(cwd = process.cwd()) {
  const dir = memoryDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'memories.json'))) writeJson(path.join(dir, 'memories.json'), []);
  if (!fs.existsSync(path.join(dir, 'config.json'))) writeJson(path.join(dir, 'config.json'), defaultConfig());
  if (!fs.existsSync(path.join(dir, 'journal.jsonl'))) fs.writeFileSync(path.join(dir, 'journal.jsonl'), '');
  commit({ type: 'repo.initialized' }, cwd);
  return dir;
}

export function loadMemories(cwd = process.cwd()) {
  return readJson(path.join(memoryDir(cwd), 'memories.json'), []);
}

export function saveMemories(mems, cwd = process.cwd()) {
  writeJson(path.join(memoryDir(cwd), 'memories.json'), mems);
}

/** Append an event to the journal and update the materialized view. */
export function commit(event, cwd = process.cwd()) {
  appendJsonl(path.join(memoryDir(cwd), 'journal.jsonl'), { ...event, at: nowIso() });
}

export function journal(cwd = process.cwd()) {
  return readJsonl(path.join(memoryDir(cwd), 'journal.jsonl'));
}

/** Add a memory. Accepts a claim string, a raw {claim,...} object, or a
 *  pre-built memory record (with id). Validates, appends event, updates view. */
export function addMemory(input, cwd = process.cwd()) {
  let mem;
  if (typeof input === 'string') {
    mem = createMemory({ claim: input });
  } else if (input && typeof input === 'object' && !input.id) {
    mem = createMemory(input);
  } else {
    mem = input;
  }
  const errs = validateMemory(mem);
  if (errs.length) throw new Error('invalid memory: ' + errs.join('; '));
  const mems = loadMemories(cwd);
  // dedupe among non-retired memories: same claim AND same kind.
  // (a retired memory may be re-asserted as a fresh record with new receipts)
  const dup = mems.find((m) => m.status !== 'retired' && m.claim.toLowerCase() === mem.claim.toLowerCase() && m.kind === mem.kind);
  if (dup) {
    return { mem: dup, duplicate: true };
  }
  mems.push(mem);
  saveMemories(mems, cwd);
  commit({ type: 'memory.added', id: mem.id, kind: mem.kind, claim: mem.claim, tags: mem.tags, evidence: mem.evidence }, cwd);
  return { mem, duplicate: false };
}

export function updateMemory(id, patch, cwd = process.cwd()) {
  const mems = loadMemories(cwd);
  const i = mems.findIndex((m) => m.id === id);
  if (i === -1) throw new Error(`no such memory: ${id}`);
  mems[i] = { ...mems[i], ...patch };
  saveMemories(mems, cwd);
  commit({ type: 'memory.updated', id, patch }, cwd);
  return mems[i];
}

export function retireMemory(id, reason, cwd = process.cwd()) {
  const mems = loadMemories(cwd);
  const m = mems.find((x) => x.id === id);
  if (!m) throw new Error(`no such memory: ${id}`);
  m.status = 'retired';
  m.retiredAt = nowIso();
  m.retiredReason = reason ?? null;
  saveMemories(mems, cwd);
  commit({ type: 'memory.retired', id, reason: reason ?? null }, cwd);
  return m;
}

export function activeMemories(cwd = process.cwd()) {
  return loadMemories(cwd).filter((m) => m.status === 'active');
}
