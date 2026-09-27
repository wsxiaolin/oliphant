# Design notes

> Why oliphant is shaped the way it is. Short, honest, change-resistent.

## The bet

**Memory for coding agents is a repo artifact, not a service.**

A repo's knowledge is small (dozens of durable claims, not millions of chat
messages). The people who need it (agents + humans) already share one
synchronization mechanism: **git**. Adding a vector DB to that problem is
like bringing a tanker to water a houseplant.

## Data model

```
.memory/
  journal.jsonl    # append-only event log — the source of truth
  memories.json    # materialized view (fast reads, git-diffable)
  health.json      # last doctor verdict (for CI and badges)
  config.json      # budgets, half-life, emitters
```

A **memory** is a claim + receipts + lifecycle fields:

```json
{
  "id": "mem_<12hex>",
  "claim": "auth proofs are HMAC-SHA256",
  "kind": "decision | fact | gotcha | pattern | preference",
  "tags": ["auth"],
  "evidence": [{ "type": "path|grep|command", "value": "..." }],
  "confidence": 0.8,
  "status": "active | stale | dead | retired",
  "ts": "…", "verifiedAt": "…", "verifications": 3, "failures": 0,
  "source": { "agent": "claude-code", "via": "mcp" }
}
```

### Journal events

`repo.initialized`, `memory.added`, `memory.updated`, `memory.retired`,
`memory.verified` (from doctor), `memory.ropening`, `doctor.run`, `compile.run`.
Append-only. Never rewritten. If `memories.json` is ever lost, the journal
rebuilds it (`oliphant import` — roadmap).

## Freshness math

```
score = 0.5^(days_since_anchor / halfLife) × confidence
        − 0.15 × failures
        + 0.05 × min(verifications, 6)
```

- **anchor** = `verifiedAt` if the memory ever passed doctor, else `ts`.
- half-life default **30 days**: unverified knowledge decays fast, verified
  knowledge decays slowly (anchor resets on each pass).
- Failures are not a death sentence by themselves — hard receipt failure is.

### Verdicts

| verdict | trigger | consequence |
|---|---|---|
| `ok` | all receipts pass | score rises, anchor refreshes |
| `rotting` | soft receipts (grep) fail, hard ones pass | warn, rank lower in compile |
| `dead` | a hard receipt (path/command) fails | status `dead`, **CI fails until retired** |

Dead memories are intentionally *sticky*: they reappear in every doctor run
until a human `forget`s them. A lie committed once must not be able to hide
by failing once and being dropped.

## Why keyword search, not embeddings

1. Scale: repo memory fits on one screen. Recency+tag ranking is enough.
2. Determinism: same query → same answer. No "depends on the embedding model".
3. Debuggability: you can read the ranking code in ten lines.
4. Zero infra: no model, no API key, no network.

If your agent memory needs ANN search, you don't have agent memory — you have
a chat log. Those are different products.

## Security posture

- Receipts run with **the same trust level as `package.json` scripts**: they
  live in your repo, authored by your team/agents, reviewed in PRs.
- `--skip-commands` for sandboxes; receipts never execute at install time,
  only when *you* invoke doctor.
- doctor prints existence/exit codes, never file contents.

## Non-goals

- Chat memory / user personalization (that's Mem0's turf).
- Vector search over huge corpora.
- A hosted anything.
