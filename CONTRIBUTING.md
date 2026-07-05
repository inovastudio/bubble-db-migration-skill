# Contributing

Thanks for helping improve this kit!

## Skill ground rules

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
- Skills may reference the kit's tools only by **absolute repo URL** (never
  relative paths — manual installs copy skills out of the repo).

## Tools ground rules

- **Zero runtime dependencies**: Node.js built-ins only (`node:` modules and
  global `fetch`); no `package.json` anywhere in the repo.
- One tool = one directory under `tools/` with a single entry `.mjs` file
  (target ≤500 lines), a README, and `node --test`-runnable tests.
- Pure logic must be exported and unit-tested; entry files use the
  `import.meta` main-guard so tests can import without executing the CLI.
- Scaffold convention: unimplemented stages print their intended execution
  plan and exit with code 2; mark the work with `TODO(scaffold):` comments.
- Tools must **never write to Bubble**. Tokens come only from env vars or
  flags and must never be persisted to any output file.

## How to contribute

1. Fork the repo and create a branch.
2. Make your change. For factual claims about Bubble's APIs or behavior, link
   the relevant Bubble documentation in the PR description.
3. Sanity-check your change: for skills, load the affected skill in at least
   one Agent Skills-compatible client and run a migration-design prompt
   against it; for tools, run `node --test` over the tool's test directory.
4. Open a PR describing what changed and why.

## Reporting issues

Open a GitHub issue for inaccuracies (Bubble evolves), unclear instructions, or
migration edge cases the skills don't cover. Real-world failure stories are
especially valuable for the risk checklists.
