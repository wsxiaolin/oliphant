// util.js — small shared helpers. Zero dependencies, Node >= 18.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PURPLE = '\x1b[35m';
export const CYAN = '\x1b[36m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const RED = '\x1b[31m';
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';
export const RESET = '\x1b[0m';

export function supportsColor() {
  return process.stdout?.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
}

function paint(open, s) {
  return supportsColor() ? open + s + RESET : String(s);
}
export const c = {
  purple: (s) => paint(PURPLE, s),
  cyan: (s) => paint(CYAN, s),
  green: (s) => paint(GREEN, s),
  yellow: (s) => paint(YELLOW, s),
  red: (s) => paint(RED, s),
  dim: (s) => paint(DIM, s),
  bold: (s) => paint(BOLD, s),
};

export function newId(prefix = 'mem') {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function daysBetween(isoA, isoB = nowIso()) {
  const a = Date.parse(isoA);
  const b = Date.parse(isoB);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, (b - a) / 86_400_000);
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file); // atomic-ish write
}

export function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

export function readJsonl(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export function rel(p, cwd = process.cwd()) {
  const r = path.relative(cwd, p);
  return r.startsWith('..') ? p : (r === '' ? '.' : r);
}

export const ELEPHANT = String.raw`
      ___
   .-'   '-.
  /  o   o  \      o l i p h a n t
 |    <3     |     never forgets. never lies.
  \  \_/    /
   '-.___.-'
`;
