# MCP integration

oliphant ships a zero-dependency MCP server over stdio:

```bash
npx -y oliphant serve
```

## Tools

| tool | when the agent should call it |
|---|---|
| `oliphant_recall(query)` | **before** assuming how the project works ("what did we decide about X?") |
| `oliphant_remember(claim, kind?, tags?, evidence?)` | **after** a durable decision, with receipts |
| `oliphant_doctor(skipCommands?)` | when suspicious that memory is stale |
| `oliphant_stats()` | curiosity, dashboards |

## Claude Code

```bash
claude mcp add oliphant -- npx -y oliphant serve
```

## Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "oliphant": { "command": "npx", "args": ["-y", "oliphant", "serve"] }
  }
}
```

## Codex / other MCP clients

Any client that speaks stdio JSON-RPC:

```json
{ "command": "npx", "args": ["-y", "oliphant", "serve"] }
```

## Prompt nudge (optional, for non-MCP workflows)

Add to your AGENTS.md (oliphant compile already does this via the Skill file):

```markdown
Before assuming how this repo works, run `npx oliphant recall "<topic>"`.
After making a durable decision, run
`npx oliphant remember "<decision>" --tag <topic> --evidence path:<file>`.
```
