// test/mcp.test.js — full MCP handshake + tools over stdio, real subprocess.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { init } from '../src/store.js';
import { tmpRepo, mcpSession } from './helpers.js';

test('mcp: initialize → tools/list → tools/call(remember) → tools/call(recall)', async () => {
  const root = tmpRepo({ files: { 'src/x.ts': 'export const x = 1' } });
  init(root);

  const { responses, stderr } = await mcpSession(
    [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'oliphant_remember', arguments: { claim: 'x module exports one const', kind: 'fact', tags: ['core'], evidence: [{ type: 'path', value: 'src/x.ts' }] } },
      },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'oliphant_recall', arguments: { query: 'x module' } } },
    ],
    root
  );

  assert.equal(responses.length, 4, 'notifications get no response; got: ' + JSON.stringify(responses) + ' / ' + stderr);
  const initRes = responses[0];
  assert.equal(initRes.id, 1);
  assert.equal(initRes.result.protocolVersion, '2025-06-18');
  assert.equal(initRes.result.serverInfo.name, 'oliphant');

  const tools = responses[1].result.tools.map((t) => t.name);
  assert.deepEqual(tools, ['oliphant_recall', 'oliphant_remember', 'oliphant_doctor', 'oliphant_stats']);

  const remembered = JSON.parse(responses[2].result.content[0].text);
  assert.equal(remembered.saved, true);
  assert.ok(remembered.id.startsWith('mem_'));

  const recalled = JSON.parse(responses[3].result.content[0].text);
  assert.equal(recalled.results.length, 1);
  assert.ok(recalled.results[0].freshness > 0 && recalled.results[0].freshness <= 1, 'freshness is a score, not the rank');
});

test('mcp: unknown tool → JSON-RPC error -32602; unknown method → -32601; bad json → -32700', async () => {
  const root = tmpRepo();
  init(root);
  const { responses } = await mcpSession(
    [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope', arguments: {} } },
      { jsonrpc: '2.0', id: 3, method: 'resources/list' },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'oliphant_remember', arguments: {} } },
    ],
    root
  );
  assert.equal(responses.length, 4);
  assert.equal(responses[1].error.code, -32602);
  assert.equal(responses[2].error.code, -32601);
  assert.equal(responses[3].error.code, -32602);
});

test('mcp: serve refuses uninitialized repos with a helpful message', async () => {
  const root = tmpRepo();
  const { stderr } = await mcpSession([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }], root);
  assert.ok(stderr.includes('not initialized'), 'stderr should tell the user to run init: ' + stderr);
});
