---
name: jarvis-architect
description: Step-by-step playbook for extending JARVIS OS — adding a tool to the agentic loop, a /local command, a hud_display/jarvis_action browser effect, a system-prompt block, or a VaultBrain (three.js) feature — with each step wired to the CLAUDE.md invariants so the change doesn't break prompt caching, the tool loop, COOP/COEP, or the vault privacy boundary. Use when implementing new JARVIS OS capabilities.
---

# JARVIS architect

Authoring-time playbook for adding new capabilities to JARVIS OS without tripping
the non-obvious runtime invariants. CLAUDE.md documents *what* the invariants are;
this skill gives the ordered *recipe* to extend the system while respecting them.

## When to use

Use when a task is to **build/extend** one of these:

| You want to… | Read |
|---|---|
| Add a custom tool to the server-side agentic loop | `references/add-a-tool.md` |
| Add a `/command` handled client-side (no API call) | `references/add-local-command.md` |
| Add a browser-effect (`jarvis_action`) tool end-to-end | `references/add-hud-action.md` |
| Change the system prompt / add a context block / model routing | `references/add-prompt-block.md` |
| Extend the three.js VaultBrain scene | `references/vaultbrain.md` |

Read only the one recipe you need — each is self-contained.

## When NOT to use

- **Reviewing** a diff, not writing one → that's the `architecture-guardian` and
  `security-reviewer` subagents (`.claude/agents/`). Don't reimplement their checks.
- Looking up the architecture in general → that's `CLAUDE.md` (the source of
  truth). These recipes only reference it; they don't restate it.

## External docs — fetch fresh, never guess

The recipes deliberately hold no external-library facts (they go stale). When a
step needs current API/library detail, pull it live:

- **Anthropic model IDs, tool-use, prompt caching, token accounting** → invoke
  the built-in **`claude-api`** skill. (The code already drifts from CLAUDE.md
  here — e.g. `resolveCommandConfig` ships `claude-opus-4-7`/`claude-sonnet-4-5`
  while CLAUDE.md says `4-8`/`4-6`. Confirm the real ID before quoting one.)
- **Three.js, React, d3-force-3d, Vite** → **context7** (`resolve-library-id`
  then `query-docs`).
- **MCP protocol / anything else** → **WebSearch**.

## Safety net (not a substitute for getting it right)

After the change, two `PreToolUse` hooks hard-block the highest-risk regressions
(`block-api-key-leak.cjs`, `guard-coop-coep-headers.cjs`), and the two review
subagents catch the rest. This skill exists to land it correctly the first time,
so those backstops stay quiet.
