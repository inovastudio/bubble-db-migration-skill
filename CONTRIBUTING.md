# Contributing

Thanks for helping improve this skill!

## Ground rules

- The skill must remain **client-agnostic**: stick to the core Agent Skills spec
  (frontmatter `name` + `description` + optional `license`/`metadata`, plain
  Markdown body). No client-specific frontmatter fields in `SKILL.md`.
- Keep `SKILL.md` under 500 lines. If a contribution needs more depth, add a
  file under `bubble-db-migration/references/` and link it from `SKILL.md`
  with clear guidance on when to read it.
- Instructions should be actionable methodology, not general knowledge the
  agent already has. Focus on what's specific to Bubble and the Data API.

## How to contribute

1. Fork the repo and create a branch.
2. Make your change. For factual claims about the Bubble Data API, link the
   relevant Bubble documentation in the PR description.
3. Sanity-check the skill by loading it in at least one Agent Skills-compatible
   client and running a migration-design prompt against it.
4. Open a PR describing what changed and why.

## Reporting issues

Open a GitHub issue for inaccuracies (Bubble's API evolves), unclear
instructions, or migration edge cases the skill doesn't cover. Real-world
failure stories are especially valuable for the risk checklist.
