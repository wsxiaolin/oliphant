// compile.js — turns the memory journal into the context files each agent reads.
//
//   AGENTS.md                        ← canonical compiled block (Codex, Gemini CLI, OpenCode, …)
//   CLAUDE.md                        ← pointer + import (Claude Code)
//   .cursor/rules/oliphant.mdc       ← Cursor
//   .claude/skills/oliphant/SKILL.md ← Agent Skills
//
// The compiled block is token-budgeted, ranked by freshness, grouped by tag,
// and idempotent (writes only when content changes).
import fs from 'node:fs';
import path from 'node:path';
import { activeMemories, loadConfig, memoryDir } from './store.js';
import { decayScore } from './memory.js';
import { estimateTokens } from './tokens.js';
import { writeJson, nowIso } from './util.js';

export const BEGIN = '<!-- OLIPHANT:BEGIN';
export const END = '<!-- OLIPHANT:END -->';

function receiptLabel(ev) {
  switch (ev.type) {
    case 'path':
      return '`' + ev.value + '`';
    case 'grep':
      return '`/' + ev.value + '/` in ' + (ev.path === '.' || !ev.path ? 'repo' : '`' + ev.path + '`');
    case 'command':
      return '`' + ev.value + '` passes';
    default:
      return ev.value;
  }
}

/** Rank memories for a limited budget: fresh + verified first. */
export function rankForCompile(mems, { halfLifeDays = 30 } = {}) {
  return [...mems]
    .map((m) => ({ m, rank: decayScore(m, { halfLifeDays }) * 2 + (m.verifications ?? 0) * 0.05 }))
    .sort((a, b) => b.rank - a.rank)
    .map((r) => r.m);
}

function formatMemoryLine(m) {
  const parts = [`- **${m.kind}** — ${m.claim}`];
  const receipts = (m.evidence ?? []).map(receiptLabel);
  if (receipts.length) parts.push(`  receipts: ${receipts.join(' · ')}`);
  return parts.join('\n');
}

function groupByFirstTag(mems) {
  const groups = new Map();
  for (const m of mems) {
    const tag = (m.tags ?? [])[0] ?? 'general';
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag).push(m);
  }
  return groups;
}

export function renderCompiledBlock(mems, { budgetTokens = 2000, halfLifeDays = 30, at = nowIso() } = {}) {
  const header =
    `${BEGIN} — machine memory, do not edit by hand. Run \`npx oliphant compile\`. -->\n` +
    `# Project Memory (oliphant)\n\n` +
    `> Every line below carries receipts, re-verified by \`npx oliphant doctor\`. Never trust a memory without receipts.\n`;

  const footer = `\n_Recall more: \`npx oliphant recall "<topic>"\` · Verify: \`npx oliphant doctor\`${END}`;

  const budget = Math.max(0, budgetTokens - estimateTokens(header) - estimateTokens(footer) - 20);
  const groups = groupByFirstTag(rankForCompile(mems, { halfLifeDays }));

  let used = 0;
  let dropped = 0;
  let body = '';
  for (const [tag, group] of groups) {
    let tagBody = `\n## ${tag}\n\n`;
    let tagUsed = estimateTokens(tagBody);
    const kept = [];
    for (const m of group) {
      const chunk = formatMemoryLine(m) + '\n';
      const cost = estimateTokens(chunk);
      if (used + tagUsed + cost > budget) {
        dropped++;
        continue;
      }
      kept.push(chunk);
      tagUsed += cost;
    }
    if (kept.length) {
      body += tagBody + kept.join('');
      used += tagUsed;
    }
  }
  if (dropped > 0) {
    body += `\n_${dropped} lower-freshness memories trimmed to fit the ${budgetTokens}-token budget — recall them on demand._\n`;
  }
  const full = header + body + footer;
  return { block: full, tokens: estimateTokens(full), kept: mems.length - dropped, dropped };
}

function upsertBlock(file, block, createHeader) {
  let src = '';
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    src = createHeader ?? '';
  }
  const beginIdx = src.indexOf(BEGIN);
  const endIdx = src.indexOf(END);
  let next;
  if (beginIdx !== -1 && endIdx !== -1) {
    const before = src.slice(0, beginIdx);
    let after = src.slice(endIdx + END.length);
    // `block` never ends with a newline; keep exactly one after END
    // (and heal trailing-whitespace drift from earlier runs).
    if (/^\s*$/.test(after)) after = '\n';
    next = before + block + after;
  } else {
    const sep = src && !src.endsWith('\n') ? '\n\n' : src ? '\n' : '';
    // fresh insert ends with exactly one newline, matching what upsert
    // normalizes to on later runs (idempotency from the very first write).
    next = src + sep + block + '\n';
  }
  return next;
}

function writeFileIfChanged(file, content) {
  try {
    if (fs.readFileSync(file, 'utf8') === content) return false;
  } catch {
    /* new file */
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

export function compile(root = process.cwd()) {
  const cfg = loadConfig(root);
  const mems = activeMemories(root);
  const rendered = renderCompiledBlock(mems, { budgetTokens: cfg.budgetTokens, halfLifeDays: cfg.halfLifeDays });
  const block = rendered.block;
  const written = [];

  if (cfg.emit.agents) {
    const file = path.join(root, 'AGENTS.md');
    const next = upsertBlock(file, block, '# AGENTS.md\n\nInstructions for coding agents working in this repo.\n\n');
    if (writeFileIfChanged(file, next)) written.push('AGENTS.md');
  }

  if (cfg.emit.claude) {
    const file = path.join(root, 'CLAUDE.md');
    const claudeBlock =
      `${BEGIN} — machine memory, do not edit by hand. -->\n` +
      `# Project Memory (oliphant)\n\nCanonical memory lives in AGENTS.md (kept in sync by \`npx oliphant compile\`).\nQuick recall: \`npx oliphant recall "<topic>"\`${END}`;
    const next = upsertBlock(file, claudeBlock, '# CLAUDE.md\n\n@AGENTS.md\n\n');
    if (writeFileIfChanged(file, next)) written.push('CLAUDE.md');
  }

  if (cfg.emit.cursor) {
    const file = path.join(root, '.cursor', 'rules', 'oliphant.mdc');
    const content =
      '---\n' +
      'description: Project memory (oliphant) — auto-compiled, receipts verified. Do not edit by hand.\n' +
      'alwaysApply: true\n' +
      '---\n\n' +
      block;
    if (writeFileIfChanged(file, content)) written.push('.cursor/rules/oliphant.mdc');
  }

  if (cfg.emit.skill) {
    const file = path.join(root, '.claude', 'skills', 'oliphant', 'SKILL.md');
    const content =
      '---\n' +
      'name: oliphant-memory\n' +
      'description: Project memory with receipts. Use before architecture changes ("what did we decide about X?") and after making decisions ("remember: ...").\n' +
      '---\n\n' +
      '# Project Memory\n\n' +
      'Before guessing how this repo works, recall what has already been decided:\n\n' +
      '```bash\nnpx oliphant recall "<topic>"\n```\n\n' +
      'After you make a decision worth keeping, record it with receipts:\n\n' +
      '```bash\nnpx oliphant remember "<decision>" --tag <topic> --evidence path:<file-you-touched>\n```\n\n' +
      'Full memory lives in AGENTS.md (compiled) and .memory/journal.jsonl (source of truth).\n';
    if (writeFileIfChanged(file, content)) written.push('.claude/skills/oliphant/SKILL.md');
  }

  const tokens = rendered.tokens;
  writeJson(path.join(memoryDir(root), 'compiled.json'), { at: nowIso(), tokens, memories: mems.length });
  return { tokens, memories: mems.length, written, block, dropped: rendered.dropped };
}
