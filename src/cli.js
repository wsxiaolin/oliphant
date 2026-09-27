// cli.js — command routing. Zero dependencies: util.parseArgs does the job.
import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

import { c, ELEPHANT, nowIso } from './util.js';
import { isInitialized, init, memoryDir, loadConfig, addMemory, retireMemory, loadMemories } from './store.js';
import { createMemory } from './memory.js';
import { compile } from './compile.js';
import { runDoctor, renderDoctorDetailed } from './doctor.js';
import { recall, renderRecall } from './recall.js';
import { computeStats, renderStats } from './stats.js';
import { serveStdio } from './mcp.js';

const VERSION = '0.1.0';

const HELP = `${c.bold('oliphant')} ${c.dim(VERSION)} — 🐘 git-native memory for coding agents. With receipts.

${c.bold('Usage')}
  oliphant <command> [options]

${c.bold('Commands')}
  ${c.cyan('init')}                        set up .memory/ in this repo
  ${c.cyan('remember')} "<claim>"          record a decision/fact/gotcha (add receipts!)
      --kind <decision|fact|gotcha|pattern|preference>
      --tag <name>                         repeatable
      --evidence <spec>                    repeatable; spec forms:
                                             path:src/auth.js
                                             grep:timingSafeEqual@src
                                             command:npm test
      --confidence <0.1-1>                 default 0.8
      --source <agent>                     who remembered (claude-code, codex, human, …)
  ${c.cyan('recall')} "<query>"            search memory (agents & humans)
  ${c.cyan('doctor')}                      re-verify every receipt against the live repo
      --skip-commands                      don't run command receipts
      --json                               machine output
  ${c.cyan('compile')}                     rebuild AGENTS.md / CLAUDE.md / .cursor / SKILL.md
  ${c.cyan('forget')} <id>                 retire a memory (kept in journal, never deleted)
  ${c.cyan('ls')}                          list memories
  ${c.cyan('stats')}                       freshness, token cost, counts
  ${c.cyan('serve')}                       run as an MCP stdio server
  ${c.cyan('help')}                        this page

${c.bold('Typical loop')}
  oliphant init
  oliphant remember "auth uses HMAC proofs, never plaintext" --tag auth --evidence path:src/auth.js
  oliphant compile && oliphant doctor
  git add .memory AGENTS.md && git commit -m "memory: auth decisions"
`;

function die(msg, code = 1) {
  console.error(c.red('✗ ' + msg));
  process.exit(code);
}

function parseEvidenceSpecs(specs = []) {
  return specs.map((spec) => {
    const s = String(spec);
    if (s.startsWith('path:') || s.startsWith('file:')) return { type: 'path', value: s.slice(s.indexOf(':') + 1) };
    if (s.startsWith('grep:')) {
      const body = s.slice(5);
      const at = body.lastIndexOf('@');
      if (at > 0) return { type: 'grep', value: body.slice(0, at), path: body.slice(at + 1) };
      return { type: 'grep', value: body, path: '.' };
    }
    if (s.startsWith('command:') || s.startsWith('test:')) return { type: 'command', value: s.slice(s.indexOf(':') + 1) };
    // bare string → treat as path
    return { type: 'path', value: s };
  });
}

async function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    console.log(VERSION);
    return;
  }

  const root = process.cwd();

  switch (cmd) {
    case 'init': {
      if (isInitialized(root)) {
        console.log(c.yellow('◍ already initialized here: ') + c.dim(path.join(root, '.memory')));
        return;
      }
      init(root);
      compile(root);
      console.log(ELEPHANT);
      console.log(c.bold('memory initialized.') + c.dim('  journal: ' + path.join(root, '.memory', 'journal.jsonl')));
      console.log('');
      console.log('  teach it your first decision:');
      console.log('  ' + c.cyan('oliphant remember "we use bun, not npm" --tag tooling --evidence path:package.json'));
      console.log('');
      console.log('  then ' + c.cyan('oliphant compile') + ' → AGENTS.md / CLAUDE.md / Cursor / Skill all updated.');
      console.log('  commit ' + c.dim('.memory/') + ' so the whole team (and every agent) shares the brain.');
      return;
    }

    case 'remember':
    case 'm': {
      if (!isInitialized(root)) die('not initialized here — run `oliphant init` first');
      const { values, positionals } = parseArgs({
        args: rest,
        options: {
          kind: { type: 'string', default: 'fact' },
          tag: { type: 'string', multiple: true },
          evidence: { type: 'string', multiple: true },
          confidence: { type: 'string', default: '0.8' },
          source: { type: 'string' },
        },
        allowPositionals: true,
        strict: false,
      });
      const claim = positionals.join(' ');
      if (!claim.trim()) die('usage: oliphant remember "<claim>" [--tag x] [--evidence path:file] [--evidence command:"npm test"]');
      const tags = [...(values.tag ?? [])];
      if (values.kind && ['decision', 'fact', 'gotcha', 'pattern', 'preference'].includes(values.kind) === false) {
        die(`bad --kind ${values.kind}`);
      }
      let mem;
      try {
        mem = createMemory({
          claim,
          kind: values.kind ?? 'fact',
          tags,
          evidence: parseEvidenceSpecs(values.evidence ?? []),
          confidence: Number(values.confidence ?? 0.8),
          source: { agent: values.source ?? 'human', via: 'cli', at: nowIso() },
        });
      } catch (e) {
        die(e.message);
      }
      const { duplicate, mem: saved } = addMemory(mem, root);
      if (duplicate) {
        console.log(c.yellow('◍ already remembered: ') + saved.claim + c.dim(` (${saved.id})`));
        return;
      }
      const receipts = saved.evidence.map((e) => `${e.type}:${e.value}${e.path && e.path !== '.' ? '@' + e.path : ''}`);
      console.log(c.green('✓ remembered') + c.dim(` ${saved.id}`));
      console.log('  ' + saved.claim);
      if (receipts.length) console.log('  receipts: ' + c.dim(receipts.join(', ')));
      else console.log('  ' + c.yellow('⚠ no receipts — this memory can rot silently. add --evidence path:<file>'));
      const { tokens } = compile(root);
      console.log(c.dim(`  compiled → AGENTS.md (+${tokens} tok block)`));
      return;
    }

    case 'recall': {
      if (!isInitialized(root)) die('not initialized here — run `oliphant init` first');
      const { positionals } = parseArgs({ args: rest, allowPositionals: true, strict: false });
      const q = positionals.join(' ');
      if (!q.trim()) die('usage: oliphant recall "<query>"');
      const hits = recall(q, root, { limit: 8 });
      console.log(renderRecall(hits));
      return;
    }

    case 'doctor': {
      if (!isInitialized(root)) die('not initialized here — run `oliphant init` first');
      const { values } = parseArgs({
        args: rest,
        options: { 'skip-commands': { type: 'boolean' }, json: { type: 'boolean' }, ci: { type: 'boolean' } },
        allowPositionals: true,
        strict: false,
      });
      const cfg = loadConfig(root);
      const report = await runDoctor(root, {
        halfLifeDays: cfg.halfLifeDays,
        skipCommands: !!values['skip-commands'],
        json: !!values.json,
      });
      if (!values.json) {
        const mems = loadMemories(root);
        renderDoctorDetailed(report, mems);
      }
      const cfgFail = cfg.ci?.failOn ?? 'dead';
      const deadCount = report.dead;
      const rottingCount = report.rotting;
      const belowFresh = report.freshness < (cfg.ci?.minFreshness ?? 0.75);
      if (values.ci) {
        if (cfgFail === 'rot' && (deadCount + rottingCount) > 0) die(`memory rot detected: ${deadCount} dead, ${rottingCount} rotting`, 1);
        if (deadCount > 0) die(`dead memories found: ${deadCount} — run 'oliphant doctor' locally and 'oliphant forget <id>' the lies`, 1);
        if (belowFresh) die(`freshness ${Math.round(report.freshness * 100)}% below threshold ${Math.round((cfg.ci?.minFreshness ?? 0.75) * 100)}%`, 1);
        console.log(c.green('✓ memory is honest'));
      }
      return;
    }

    case 'compile': {
      if (!isInitialized(root)) die('not initialized here — run `oliphant init` first');
      const r = compile(root);
      if (r.written.length) console.log(c.green('✓ compiled') + c.dim(` ${r.memories} memories → `) + r.written.join(', ') + c.dim(` (${r.tokens} tok block)`));
      else console.log(c.dim('◍ up to date — nothing to write') + ` (${r.tokens} tok block)`);
      return;
    }

    case 'forget': {
      if (!isInitialized(root)) die('not initialized here — run `oliphant init` first');
      const { positionals } = parseArgs({ args: rest, allowPositionals: true, strict: false });
      const id = positionals[0];
      if (!id) die('usage: oliphant forget <id>');
      const m = retireMemory(id, 'forgotten via cli', root);
      compile(root);
      console.log(c.yellow('◍ retired') + c.dim(` ${m.id}: `) + m.claim);
      console.log(c.dim('  (kept in the journal — memory is never silently deleted)'));
      return;
    }

    case 'ls': {
      if (!isInitialized(root)) die('not initialized here — run `oliphant init` first');
      const mems = loadMemories(root);
      if (!mems.length) {
        console.log(c.dim('empty. remember something: ') + c.cyan('oliphant remember "..."'));
        return;
      }
      for (const m of mems) {
        const badge = m.status === 'active' ? c.green('●') : m.status === 'retired' ? c.dim('◌') : c.red('✗');
        console.log(`${badge} ${c.dim(m.id)}  ${m.kind.padEnd(10)} ${m.claim}  ${c.dim((m.tags ?? []).map((t) => '#' + t).join(' '))}`);
      }
      return;
    }

    case 'stats': {
      if (!isInitialized(root)) die('not initialized here — run `oliphant init` first');
      const s = computeStats(root);
      renderStats(s);
      return;
    }

    case 'serve': {
      try {
        await serveStdio({ root });
      } catch (e) {
        die(e.message);
      }
      return;
    }

    default:
      die(`unknown command: ${cmd}\n\n${HELP}`);
  }
}

export { main };
