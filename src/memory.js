// memory.js — the memory record model. A memory is a *claim* backed by *receipts*.
import { newId, nowIso, daysBetween } from './util.js';

export const KINDS = ['decision', 'fact', 'gotcha', 'pattern', 'preference'];
export const EVIDENCE_TYPES = ['path', 'grep', 'command'];
export const STATUSES = ['active', 'stale', 'retired', 'dead'];

/**
 * Evidence "receipt" formats:
 *   { type: 'path',    value: 'src/auth.js' }                        — must exist
 *   { type: 'grep',    value: 'timingSafeEqual', path: 'src' }       — pattern must appear under path
 *   { type: 'command', value: 'npm test', timeoutSec?: 60 }            — must exit 0
 * (type 'test' is accepted as sugar for 'command')
 */
export function normalizeEvidence(raw) {
  const list = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const e of list) {
    if (typeof e === 'string') {
      out.push({ type: 'path', value: e });
      continue;
    }
    if (!e || typeof e !== 'object') continue;
    const type = e.type === 'test' ? 'command' : e.type;
    if (!EVIDENCE_TYPES.includes(type)) {
      throw new Error(`unknown evidence type: ${type} (expected path|grep|command)`);
    }
    if (typeof e.value !== 'string' || !e.value.trim()) {
      throw new Error('evidence.value must be a non-empty string');
    }
    if (type === 'grep' && e.path != null && typeof e.path !== 'string') {
      throw new Error('evidence.path must be a string');
    }
    out.push(type === 'grep' ? { type, value: e.value, path: e.path ?? '.' } : { type, value: e.value });
  }
  return out;
}

export function createMemory({ claim, kind = 'fact', evidence = [], tags = [], confidence = 0.8, source }) {
  if (typeof claim !== 'string' || !claim.trim()) {
    throw new Error('claim must be a non-empty string');
  }
  if (claim.trim().length < 4) {
    throw new Error('claim is too short to be a memory (min 4 chars)');
  }
  if (!KINDS.includes(kind)) {
    throw new Error(`unknown kind: ${kind} (expected ${KINDS.join('|')})`);
  }
  const conf = Number(confidence);
  if (!Number.isFinite(conf) || conf < 0.1 || conf > 1) {
    throw new Error('confidence must be within [0.1, 1]');
  }
  const ev = normalizeEvidence(evidence);
  const tagList = [...new Set((Array.isArray(tags) ? tags : [tags]).map((t) => String(t).toLowerCase().trim()).filter(Boolean))];
  return {
    id: newId(),
    ts: nowIso(),
    kind,
    claim: claim.trim(),
    evidence: ev,
    tags: tagList,
    confidence: Math.round(conf * 100) / 100,
    source: source ?? { agent: 'human', via: 'cli' },
    status: 'active',
    verifiedAt: null,
    verifications: 0,
    failures: 0,
  };
}

/**
 * Freshness score ∈ [0,1]. Trust halves every `halfLifeDays` since last
 * verification; failure history drags it down; a streak of successful
 * verifications builds trust back up.
 */
export function decayScore(mem, { halfLifeDays = 30, now = nowIso() } = {}) {
  const anchor = mem.verifiedAt ?? mem.ts;
  const days = daysBetween(anchor, now);
  let s = (mem.confidence ?? 0.8) * Math.pow(0.5, days / halfLifeDays);
  s = Math.max(0, s - 0.15 * (mem.failures ?? 0));
  s = Math.min(1, s + 0.05 * Math.min(mem.verifications ?? 0, 6));
  return Math.round(s * 1000) / 1000;
}

export function healthLabel(score) {
  if (score >= 0.75) return { label: 'fresh', emoji: '🟢' };
  if (score >= 0.45) return { label: 'aging', emoji: '🟡' };
  if (score >= 0.25) return { label: 'rotting', emoji: '🟠' };
  return { label: 'rot', emoji: '🔴' };
}

export function validateMemory(m) {
  const errs = [];
  if (!m || typeof m !== 'object') return ['not an object'];
  if (typeof m.id !== 'string' || !m.id) errs.push('missing id');
  if (typeof m.claim !== 'string' || !m.claim) errs.push('missing claim');
  if (!KINDS.includes(m.kind)) errs.push(`bad kind ${m.kind}`);
  if (!STATUSES.includes(m.status)) errs.push(`bad status ${m.status}`);
  if (!Array.isArray(m.evidence)) errs.push('evidence must be an array');
  return errs;
}
