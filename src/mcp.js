// mcp.js — Model Context Protocol server over stdio. Hand-rolled JSON-RPC 2.0,
// zero dependencies. This is how agents talk to oliphant natively.
//
//   claude mcp add oliphant -- npx -y oliphant serve
//   cursor:   command: npx, args: ["-y","oliphant","serve"]
//
import { createInterface } from 'node:readline';
import { recall } from './recall.js';
import { runDoctor } from './doctor.js';
import { computeStats } from './stats.js';
import { isInitialized, addMemory, loadConfig, requireInit } from './store.js';
import { createMemory, decayScore } from './memory.js';
import { compile } from './compile.js';
import { nowIso } from './util.js';

const PROTOCOL_VERSION = '2025-06-18';

const TOOL_SCHEMAS = [
  {
    name: 'oliphant_recall',
    description: 'Search the project memory of this repo (decisions, gotchas, patterns) with receipts. Use before assuming how the project works.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'topic or keywords, e.g. "auth" or "why bun"' } },
      required: ['query'],
    },
  },
  {
    name: 'oliphant_remember',
    description: 'Persist a durable project decision/fact/gotcha into versioned repo memory. Provide receipts (file paths, grep patterns, or commands) so it can be re-verified later.',
    inputSchema: {
      type: 'object',
      properties: {
        claim: { type: 'string', description: 'the fact/decision, one sentence' },
        kind: { type: 'string', enum: ['decision', 'fact', 'gotcha', 'pattern', 'preference'] },
        tags: { type: 'array', items: { type: 'string' } },
        evidence: {
          type: 'array',
          description: 'receipts that keep this memory honest',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['path', 'grep', 'command'] },
              value: { type: 'string' },
              path: { type: 'string', description: 'for grep: where to search' },
            },
            required: ['type', 'value'],
          },
        },
      },
      required: ['claim'],
    },
  },
  {
    name: 'oliphant_doctor',
    description: 'Re-verify every memory in this repo against the current code and report freshness. Slow memories rot; dead ones must be retired.',
    inputSchema: { type: 'object', properties: { skipCommands: { type: 'boolean', description: 'skip command receipts (slow/untrusted environments)' } } },
  },
  {
    name: 'oliphant_stats',
    description: 'Memory health overview: counts, freshness, token cost of the compiled context block.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function jsonResult(obj) {
  return textResult(JSON.stringify(obj, null, 2));
}

async function callTool(root, name, args) {
  switch (name) {
    case 'oliphant_recall': {
      const q = String(args?.query ?? '');
      if (!q.trim()) throw new Error('query must not be empty');
      if (!isInitialized(root)) return textResult('no memory in this repo yet — run `npx oliphant init` or `oliphant remember "..."`');
      const hits = recall(q, root, { limit: 8 });
      if (!hits.length) return textResult(`no memory matched "${q}". If you just learned it, remember it: npx oliphant remember`);
      return jsonResult({
        query: q,
        results: hits.map(({ mem, score }) => ({
          id: mem.id,
          kind: mem.kind,
          claim: mem.claim,
          tags: mem.tags,
          receipts: mem.evidence,
          freshness: mem.lastScore ?? decayScore(mem),
          verifiedAt: mem.verifiedAt,
        })),
      });
    }
    case 'oliphant_remember': {
      if (!isInitialized(root)) return textResult('not initialized — run `npx oliphant init` first', true);
      let mem;
      try {
        mem = createMemory({
          claim: String(args?.claim ?? ''),
          kind: args?.kind,
          tags: args?.tags,
          evidence: args?.evidence,
          source: { agent: 'mcp-client', via: 'oliphant_remember', at: nowIso() },
        });
      } catch (e) {
        // validation failures are the caller's fault → invalid params
        throw Object.assign(e, { code: -32602 });
      }
      const { mem: saved, duplicate } = addMemory(mem, root);
      // recompile so humans reviewing the PR see it too
      try {
        compile(root);
      } catch {
        /* compile is best-effort here */
      }
      return jsonResult({ saved: !duplicate, duplicate, id: saved.id, claim: saved.claim, receipts: saved.evidence });
    }
    case 'oliphant_doctor': {
      if (!isInitialized(root)) return textResult('not initialized — run `npx oliphant init` first', true);
      const cfg = loadConfig(root);
      const report = await runDoctor(root, { halfLifeDays: cfg.halfLifeDays, skipCommands: !!args?.skipCommands });
      return jsonResult({ checked: report.checked, ok: report.ok, rotting: report.rotting, dead: report.dead, freshness: report.freshness, results: report.results.map((r) => ({ id: r.id, verdict: r.verdict, score: r.score })) });
    }
    case 'oliphant_stats': {
      if (!isInitialized(root)) return textResult('not initialized — run `npx oliphant init` first');
      return jsonResult(computeStats(root));
    }
    default:
      throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32602 });
  }
}

export function createServer({ root = process.cwd() } = {}) {
  return {
    async handle(msg) {
      const { id, method, params } = msg;
      const isRequest = id !== undefined && id !== null;
      try {
        switch (method) {
          case 'initialize':
            return {
              id,
              result: {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: { name: 'oliphant', version: '0.1.0' },
                instructions:
                  'oliphant: git-native project memory with receipts. Use oliphant_recall before assuming project conventions; oliphant_remember after durable decisions.',
              },
            };
          case 'notifications/initialized':
            return null; // notification — no response
          case 'ping':
            return { id, result: {} };
          case 'tools/list':
            return { id, result: { tools: TOOL_SCHEMAS } };
          case 'tools/call': {
            const name = params?.name;
            const args = params?.arguments ?? {};
            if (!name) throw Object.assign(new Error('missing params.name'), { code: -32602 });
            const result = await callTool(root, name, args);
            return { id, result };
          }
          default:
            if (String(method).startsWith('notifications/')) return null;
            if (isRequest) return { id, error: { code: -32601, message: `method not found: ${method}` } };
            return null;
        }
      } catch (err) {
        if (isRequest) {
          const code = err.code ?? -32603;
          return { id, error: { code, message: err.message ?? String(err) } };
        }
        // notification errors are swallowed (log to stderr for debugging)
        process.stderr.write(`[oliphant] notification error: ${err.message}\n`);
        return null;
      }
    }
  };
}

/** Run the stdio server loop. */
export async function serveStdio({ root = process.cwd() } = {}) {
  requireInit(root);
  const server = createServer({ root });
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  process.stderr.write('[oliphant] mcp server ready (stdio)\n');
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n');
      continue;
    }
    const resp = await server.handle(msg);
    if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
  }
}
