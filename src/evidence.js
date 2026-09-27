// evidence.js — the receipts checker. This is the part that keeps memory honest.
//
// Each receipt is re-verified against the CURRENT repo:
//   path    → the file/dir still exists
//   grep    → the pattern still appears under the given path
//   command → the command still exits 0
// Commands run with a timeout, in the repo cwd, and can be skipped with
// `--skip-commands` (e.g. in sandboxes). Same trust level as package.json
// scripts: they come from your own repo's journal.
import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { nowIso } from './util.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

function checkPath(root, ev) {
  const target = path.resolve(root, ev.value);
  const ok = fs.existsSync(target);
  let detail;
  if (ok) {
    const st = fs.statSync(target);
    detail = st.isDirectory() ? 'dir exists' : `exists (${st.size} bytes)`;
  } else {
    detail = 'missing';
  }
  return { ok, detail };
}

function checkGrep(root, ev) {
  const base = path.resolve(root, ev.path ?? '.');
  if (!fs.existsSync(base)) return { ok: false, detail: `path missing: ${ev.path ?? '.'}` };
  let pattern;
  try {
    pattern = new RegExp(ev.value, 'i');
  } catch {
    return { ok: false, detail: 'invalid regex' };
  }
  // `path` may point at a file (grep one file) or a dir (walk it).
  const files = fs.statSync(base).isFile() ? [base] : listFiles(base, 500);
  for (const f of files) {
    let content;
    try {
      if (fs.statSync(f).size > 1_000_000) continue;
      content = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    if (pattern.test(content)) {
      return { ok: true, detail: 'found in ' + path.relative(root, f) };
    }
  }
  return { ok: false, detail: `pattern /${ev.value}/ not found under ${ev.path ?? '.'}` };
}

function listFiles(dir, limit) {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.memory', '.next', 'coverage']);
  const walk = (d) => {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name)) walk(p);
      } else if (e.isFile()) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out;
}

function checkCommand(root, ev) {
  const timeoutMs = Math.min(Number(ev.timeoutSec) * 1000 || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  return new Promise((resolve) => {
    // shell mode so receipts can be honest shell one-liners (`npm test`,
    // `node -e "process.exit(1)"`) — same semantics as package.json scripts.
    exec(ev.value, { cwd: root, timeout: timeoutMs, windowsHide: true }, (err, _stdout, stderr) => {
      if (!err) return resolve({ ok: true, detail: 'exit 0' });
      const code = err.code ?? 'ERR';
      const isTimeout = err.killed || err.signal === 'SIGTERM';
      resolve({ ok: false, detail: isTimeout ? 'timeout' : `exit ${code}${stderr ? ': ' + String(stderr).split('\n')[0].slice(0, 80) : ''}` });
    });
  });
}

export async function verifyEvidence(root, ev) {
  let result;
  switch (ev.type) {
    case 'path':
      result = checkPath(root, ev);
      break;
    case 'grep':
      result = checkGrep(root, ev);
      break;
    case 'command':
      result = await checkCommand(root, ev);
      break;
    default:
      result = { ok: false, detail: 'unknown type' };
  }
  return { ...result, checkedAt: nowIso(), type: ev.type, value: ev.value };
}

/**
 * Verify one memory. Verdict semantics:
 *   ok       → every receipt holds
 *   rotting  → soft receipts (grep) failed but core ones (path/command) hold
 *   dead     → a hard receipt (path/command) failed
 */
export async function verifyMemory(root, mem, { skipCommands = false } = {}) {
  const checks = [];
  for (const ev of mem.evidence ?? []) {
    if (skipCommands && ev.type === 'command') {
      checks.push({ type: 'command', value: ev.value, ok: null, detail: 'skipped', checkedAt: nowIso() });
      continue;
    }
    checks.push(await verifyEvidence(root, ev));
  }
  const hard = checks.filter((c) => c.type === 'path' || c.type === 'command');
  const soft = checks.filter((c) => c.type === 'grep');
  const hardFail = hard.some((c) => c.ok === false);
  const softFail = soft.some((c) => c.ok === false);
  const verdict = hardFail ? 'dead' : softFail ? 'rotting' : 'ok';
  return { verdict, checks };
}

export function summarizeChecks(checks) {
  return checks.map((c) => `${c.ok === null ? '◌' : c.ok ? '✓' : '✗'} ${c.type}:${truncate(c.value, 40)} — ${c.detail}`);
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
