# Bubble DB Migration — Agent Skill

An [Agent Skill](https://agentskills.io) that teaches AI coding agents how to design and build migrations from **Bubble.io databases** to external relational databases (Postgres, Supabase, MySQL, …) using the **Bubble Data API**.

It encodes the full methodology: Data API constraints, a five-stage checkpoint-driven pipeline, Bubble → SQL type mapping (lists of things, option sets, references, files), incremental sync with deletion reconciliation, and a risk checklist built from real-world Bubble migrations.

Works with any AI client that supports the open Agent Skills format (`SKILL.md`), including Claude Code, Claude.ai, OpenAI Codex CLI, Gemini CLI, GitHub Copilot, Cursor, Cline, and others.

## What it covers

- **Bubble Data API constraints** — cursor pagination, `/meta` schema discovery, workload-unit rate limits, admin tokens vs privacy rules, no deletion tombstones
- **Pipeline architecture** — Schema Discovery → Extraction → Transformation → Load → Validation, with raw NDJSON staging and per-page checkpoints
- **Type mapping** — Bubble unique IDs as primary keys, lists of things → ordered junction tables, option sets → lookup tables, geographic addresses, files/images
- **Incremental sync** — Modified Date deltas with overlap windows, plus ID-sweep deletion reconciliation
- **Validation & risks** — row counts, spot checksums, dangling-reference ledgers, and the edge cases that break Bubble migrations in practice

## Installation

The skill is a single folder (`bubble-db-migration/`) containing a `SKILL.md`. Install it wherever your client discovers skills:

**Claude Code**

```bash
# Project-level
cp -r bubble-db-migration .claude/skills/

# Or user-level (available in all projects)
cp -r bubble-db-migration ~/.claude/skills/
```

**Claude.ai / Claude apps** — package the folder as a `.skill` file (zip of the folder) and upload it via Settings → Capabilities → Skills, or use the packaged release from this repo.

**Other Agent Skills–compatible clients** (Codex CLI, Gemini CLI, Copilot, Cursor, Cline, …) — place the `bubble-db-migration/` folder in your client's skills directory. Consult your client's documentation for the exact path; the skill uses only the core spec (name, description, markdown body), so no client-specific adjustments are needed.

## Usage

Once installed, the skill activates automatically when you ask your agent things like:

- "Help me migrate my Bubble app's database to Supabase"
- "Design an export pipeline using the Bubble Data API"
- "How should I map Bubble's 'list of things' fields to Postgres?"
- "Set up an incremental sync from Bubble to Postgres so I can migrate gradually"

The skill instructs the agent to always produce a reviewable migration plan (schema, DDL, workload-unit estimate) before extracting anything.

## Scope

This skill covers **data migration only** — it does not cover migrating Bubble workflows, backend logic, or privacy rules, and it does not write back to Bubble.

Only Bubble data types with **"Enable Data API"** checked are visible to the Data API; the skill instructs agents to detect and report references to unexposed types rather than silently skipping them.

## Contributing

Contributions welcome — especially:

- Corrections or additions to the Data API constraint list as Bubble evolves
- Additional target-database mapping notes (MySQL, SQLite, MongoDB, …)
- Edge cases from real migrations for the risk checklist

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Inova Studio
