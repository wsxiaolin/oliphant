// test/helpers.js — temp repo scaffolding for tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function tmpRepo({ files = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oliphant-test-'));
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

// fileURLToPath, NOT url.pathname — pathname breaks on Windows (`/C:/...`).
export const OLIPHANT_BIN = fileURLToPath(new URL('../bin/oliphant.js', import.meta.url));

export async function runCli(args, cwd) {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile(process.execPath, [OLIPHANT_BIN, ...args], { cwd, timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err?.code ?? 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** Talk to an oliphant MCP server over stdio. */
export async function mcpSession(msgs, cwd) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [OLIPHANT_BIN, 'serve'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let errOut = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (errOut += d));
    child.on('error', reject);
    child.on('exit', () => {
      const lines = out.split('\n').filter((l) => l.trim());
      resolve({ responses: lines.map((l) => JSON.parse(l)), stderr: errOut });
    });
    for (const m of msgs) child.stdin.write(JSON.stringify(m) + '\n');
    child.stdin.end();
  });
}
