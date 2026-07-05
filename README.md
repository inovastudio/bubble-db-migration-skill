# Bubble Migration Kit

Everything an AI coding agent (or a human) needs to migrate a **Bubble.io application** to your own stack — database, backend logic, frontend, files, and auth.

The kit has three pillars:

| Pillar | What it is | Works with |
|---|---|---|
| **Skills** | Five [Agent Skills](https://agentskills.io) encoding the migration methodology: Bubble-specific constraints, staged pipelines, mapping tables, risk checklists | Any Agent Skills client: Claude Code, Claude.ai, Codex CLI, Gemini CLI, Copilot, Cursor, Cline, … |
| **Tools** | Zero-dependency Node.js CLIs implementing the pipelines: Data API export/sync, asset discovery, DDL generation | Node.js 18+, no install step |
| **Plugin** | One-command install of the whole kit as a Claude Code plugin | Claude Code |

## Install

**As a Claude Code plugin** (skills + tools in one step):

```
/plugin marketplace add inovastudio/bubble-db-migration-skill
/plugin install bubble-migration-kit@bubble-migration
```

**Manual skill copy** (any Agent Skills client):

```bash
# One skill, project-level
cp -r skills/bubble-db-migration .claude/skills/

# All skills, user-level (available in all projects)
cp -r skills/* ~/.claude/skills/
```

**Claude.ai / Claude apps** — package a skill folder as a `.skill` file (zip of the folder) and upload it via Settings → Capabilities → Skills.

**Other Agent Skills–compatible clients** — place the skill folder(s) in your client's skills directory; the skills use only the core spec (name, description, markdown body), so no client-specific adjustments are needed.

## The skills

| Skill | Migrates | Key topics |
|---|---|---|
| [`bubble-db-migration`](skills/bubble-db-migration/SKILL.md) | Database → Postgres / Supabase / MySQL | Data API pipeline, type mapping, incremental sync, deletion reconciliation |
| [`bubble-workflows-migration`](skills/bubble-workflows-migration/SKILL.md) | Workflows & backend logic → server-side code | No-export constraint, inventory method, scheduling & queues, parallel-run validation |
| [`bubble-ui-rebuild`](skills/bubble-ui-rebuild/SKILL.md) | Pages & elements → React / Next.js / Vue / Svelte | Element mapping, responsive engines, data-binding map |
| [`bubble-files-migration`](skills/bubble-files-migration/SKILL.md) | Bubble-hosted files → Supabase Storage / R2 / S3 | URL discovery & canonicalization, private files, DB URL rewrite |
| [`bubble-auth-migration`](skills/bubble-auth-migration/SKILL.md) | Users, auth & privacy rules → Supabase Auth / Auth0 + RLS | Password-hash constraint, credential strategies, privacy rules → RLS |

### Which skill do I need?

- **Exporting data or keeping a synced SQL copy** → `bubble-db-migration`
- **Rebuilding business logic, API endpoints, scheduled jobs** → `bubble-workflows-migration`
- **Rebuilding pages and components** → `bubble-ui-rebuild`
- **Moving uploads and images off Bubble's storage** → `bubble-files-migration`
- **Logins, user accounts, permissions** → `bubble-auth-migration`

For a **full migration**, the typical order is: database → files → auth → workflows → UI, with the database skill's incremental sync keeping Bubble as the source of truth until cutover. The skills cross-reference each other at the hand-off points (asset manifest, synced users table, endpoint contracts).

Example prompts once installed: "Help me migrate my Bubble app's database to Supabase" · "Rebuild my Bubble backend workflows as a FastAPI service" · "Move all my app's images off Bubble to R2 and fix the URLs in Postgres" · "Translate my Bubble privacy rules into Supabase RLS policies". Every skill instructs the agent to produce a reviewable plan before changing or transferring anything.

## The tools

Single-file Node.js 18+ CLIs with zero npm dependencies — see [`tools/`](tools/) for details and status:

| Tool | Status | What it does |
|---|---|---|
| [`bubble-export`](tools/bubble-export/) | ✅ ready | Schema discovery with type inference, resumable Data API export to NDJSON, Modified Date incremental sync, ID-sweep deletion detection |
| [`bubble-assets`](tools/bubble-assets/) | 🟡 partial | Asset discovery + URL canonicalization ready; transfer / rewrite / verify scaffolded |
| [`bubble-load`](tools/bubble-load/) | 🟡 partial | schema.json → Postgres DDL ready; NDJSON load scaffolded |

```bash
export BUBBLE_APP_URL=https://myapp.bubbleapps.io BUBBLE_API_TOKEN=...   # ADMIN token

node tools/bubble-export/bubble-export.mjs discover           # schema plan — review it
node tools/bubble-export/bubble-export.mjs export --limit 500 # small dry run
node tools/bubble-export/bubble-export.mjs export             # full export (resumable)
node tools/bubble-export/bubble-export.mjs sync               # deltas since last run
node tools/bubble-export/bubble-export.mjs sweep              # detect deletions
```

## Scope

- The kit covers the full migration surface of a Bubble app: data, files, auth/privacy rules, backend logic, and UI.
- **Nothing here writes back to Bubble** — the Bubble app is treated as a read-only source until decommission.
- Bubble exposes no export API for workflows, page definitions, or privacy rules. The workflows, UI, and auth skills therefore encode **re-implementation methodology** (inventory → mapping → rebuild → validation), not automated conversion — and they say so honestly.
- Only Bubble data types with **"Enable Data API"** checked are visible to the Data API, and a non-admin token silently yields partial exports; the skills and tools surface both caveats.

## Contributing

Contributions welcome — especially:

- Corrections or additions to the constraint lists as Bubble evolves
- Implementations for the scaffolded tool stages (grep for `TODO(scaffold)`)
- Additional target mappings (other databases, auth providers, storage backends, frontend frameworks)
- Edge cases from real migrations for the risk checklists

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Inova Studio
