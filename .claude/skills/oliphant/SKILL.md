---
name: oliphant-memory
description: Project memory with receipts. Use before architecture changes ("what did we decide about X?") and after making decisions ("remember: ...").
---

# Project Memory

Before guessing how this repo works, recall what has already been decided:

```bash
npx oliphant recall "<topic>"
```

After you make a decision worth keeping, record it with receipts:

```bash
npx oliphant remember "<decision>" --tag <topic> --evidence path:<file-you-touched>
```

Full memory lives in AGENTS.md (compiled) and .memory/journal.jsonl (source of truth).
