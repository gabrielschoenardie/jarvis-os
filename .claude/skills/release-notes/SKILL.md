---
name: release-notes
description: Draft release notes for JARVIS OS from merged PRs/commits since the last tag (or a given ref). User-only — invoke with /release-notes.
disable-model-invocation: true
---

# Release notes

Draft a release-notes summary for this repo (`jarvis-os`) from the commit/PR history since the last release point.

## Steps

1. Determine the range:
   - If the user gave a ref/tag/date in `$ARGUMENTS`, use that as the starting point.
   - Otherwise, find the most recent tag (`git describe --tags --abbrev=0`); if there is no tag, use the last ~20 merge commits on `main` as a reasonable window.
2. Collect merged PRs in range: `git log <range> --merges --oneline`, plus `git log <range> --no-merges --oneline` for direct commits (this repo mixes both). For PRs, prefer `gh pr list --state merged --search "merged:>=<date>"` when `gh` is available and authenticated, since it gives PR numbers/authors/labels that raw git log doesn't.
3. Group changes by area using the repo's actual structure, not generic categories — e.g. "Voice / VAD", "VaultBrain (three.js)", "Weather", "Tool loop / API", "UI". Skim `CLAUDE.md` if unsure which area a file belongs to.
4. For each entry, write one line in the style already used in this repo's commit messages (terse, present-tense, no ticket numbers): e.g. "Replace arc reactor hologram with 3D Obsidian vault brain (VAULT mode)".
5. Flag anything that touches the invariants in CLAUDE.md (prompt caching, COOP/COEP headers, API key boundaries) with a short "⚠ touches X" note — these are the changes most likely to need a callout even if the commit message doesn't mention it.
6. Output as Markdown under a version/date heading. Ask the user before writing it to a file (e.g. `CHANGELOG.md`) or posting anywhere — this skill only drafts, it doesn't publish.

Keep the tone matter-of-fact and specific, matching the existing git history — no marketing language, no emoji unless the user asks.
