#!/usr/bin/env node
// oliphant 🐘 — git-native memory for coding agents.
import { main } from '../src/cli.js';

main().catch((err) => {
  console.error('✗ ' + (err?.message ?? err));
  process.exit(1);
});
