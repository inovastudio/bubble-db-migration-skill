# Contributing

Thanks for helping improve these skills!

## Ground rules

- The skills must remain **client-agnostic**: stick to the core Agent Skills spec
  (frontmatter `name` + `description` + optional `license`/`metadata`, plain
  Markdown body). No client-specific frontmatter fields in any `SKILL.md`.
- Each skill lives in `skills/<name>/` with a `SKILL.md` whose frontmatter
  `name` matches the folder name.
- Keep skills self-contained: cross-reference sibling skills **by name only**,
  never by relative path — skills are installed independently.
- Keep each `SKILL.md` under 500 lines. If a contribution needs more depth, add
  a file under `skills/<skill-name>/references/` and link it from that skill's
  `SKILL.md` with clear guidance on when to read it.
- Instructions should be actionable methodology, not general knowledge the
  agent already has. Focus on what's specific to Bubble — the Data API,
  workflows, the responsive engines, file storage, privacy rules — and the
  migration failure modes around them.

## How to contribute

1. Fork the repo and create a branch.
2. Make your change. For factual claims about Bubble's APIs or behavior, link
   the relevant Bubble documentation in the PR description.
3. Sanity-check the affected skill by loading it in at least one Agent
   Skills-compatible client and running a migration-design prompt against it.
4. Open a PR describing what changed and why.

## Reporting issues

Open a GitHub issue for inaccuracies (Bubble evolves), unclear instructions, or
migration edge cases the skills don't cover. Real-world failure stories are
especially valuable for the risk checklists.
