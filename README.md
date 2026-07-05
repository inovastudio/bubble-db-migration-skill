# Bubble.io Migration Skills

A collection of [Agent Skills](https://agentskills.io) that teach AI coding agents how to migrate a **Bubble.io application** to your own stack — database, backend logic, frontend, files, and auth.

Each skill encodes a battle-tested methodology: the Bubble-specific constraints to design around, a staged pipeline, construct-by-construct mapping tables, and a risk checklist built from real-world migrations.

Works with any AI client that supports the open Agent Skills format (`SKILL.md`), including Claude Code, Claude.ai, OpenAI Codex CLI, Gemini CLI, GitHub Copilot, Cursor, Cline, and others.

## The skills

| Skill | Migrates | Key topics |
|---|---|---|
| [`bubble-db-migration`](skills/bubble-db-migration/SKILL.md) | Database → Postgres / Supabase / MySQL | Data API pipeline, type mapping, incremental sync, deletion reconciliation |
| [`bubble-workflows-migration`](skills/bubble-workflows-migration/SKILL.md) | Workflows & backend logic → server-side code | No-export constraint, inventory method, scheduling & queues, parallel-run validation |
| [`bubble-ui-rebuild`](skills/bubble-ui-rebuild/SKILL.md) | Pages & elements → React / Next.js / Vue / Svelte | Element mapping, responsive engines, data-binding map |
| [`bubble-files-migration`](skills/bubble-files-migration/SKILL.md) | Bubble-hosted files → Supabase Storage / R2 / S3 | URL discovery & canonicalization, private files, DB URL rewrite |
| [`bubble-auth-migration`](skills/bubble-auth-migration/SKILL.md) | Users, auth & privacy rules → Supabase Auth / Auth0 + RLS | Password-hash constraint, credential strategies, privacy rules → RLS |

## Which skill do I need?

- **Exporting data or keeping a synced SQL copy** → `bubble-db-migration`
- **Rebuilding business logic, API endpoints, scheduled jobs** → `bubble-workflows-migration`
- **Rebuilding pages and components** → `bubble-ui-rebuild`
- **Moving uploads and images off Bubble's storage** → `bubble-files-migration`
- **Logins, user accounts, permissions** → `bubble-auth-migration`

For a **full migration**, the typical order is: database → files → auth → workflows → UI, with the database skill's incremental sync keeping Bubble as the source of truth until cutover. The skills cross-reference each other at the hand-off points (asset manifest, synced users table, endpoint contracts).

## Installation

Each skill is a folder under `skills/` containing a `SKILL.md`. Install whichever ones you need wherever your client discovers skills:

**Claude Code**

```bash
# One skill, project-level
cp -r skills/bubble-db-migration .claude/skills/

# All skills, user-level (available in all projects)
cp -r skills/* ~/.claude/skills/
```

**Claude.ai / Claude apps** — package a skill folder as a `.skill` file (zip of the folder) and upload it via Settings → Capabilities → Skills.

**Other Agent Skills–compatible clients** (Codex CLI, Gemini CLI, Copilot, Cursor, Cline, …) — place the skill folder(s) in your client's skills directory. Consult your client's documentation for the exact path; the skills use only the core spec (name, description, markdown body), so no client-specific adjustments are needed.

## Usage

Once installed, a skill activates automatically when you ask your agent things like:

- "Help me migrate my Bubble app's database to Supabase" (`bubble-db-migration`)
- "Rebuild my Bubble backend workflows as a FastAPI service" (`bubble-workflows-migration`)
- "Rebuild my Bubble app's dashboard page in Next.js" (`bubble-ui-rebuild`)
- "Move all my app's images off Bubble to R2 and fix the URLs in Postgres" (`bubble-files-migration`)
- "Translate my Bubble privacy rules into Supabase RLS policies" (`bubble-auth-migration`)

Every skill instructs the agent to produce a reviewable plan (inventory, mapping, estimates) before changing or transferring anything.

## Scope

- Together, the skills cover the full migration surface of a Bubble app: data, files, auth/privacy rules, backend logic, and UI.
- **None of the skills write back to Bubble** — the Bubble app is treated as a read-only source until decommission.
- Bubble exposes no export API for workflows, page definitions, or privacy rules. The workflows, UI, and auth skills therefore encode **re-implementation methodology** (inventory → mapping → rebuild → validation), not automated conversion — and they say so honestly.
- Only Bubble data types with **"Enable Data API"** checked are visible to the Data API; the database skill instructs agents to detect and report references to unexposed types rather than silently skipping them.

## Contributing

Contributions welcome — especially:

- Corrections or additions to the constraint lists as Bubble evolves
- Additional target mappings (other databases, auth providers, storage backends, frontend frameworks)
- Edge cases from real migrations for the risk checklists

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Inova Studio
