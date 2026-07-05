---
name: bubble-workflows-migration
description: Methodology for migrating Bubble.io workflows, backend workflows, and API workflows to server-side code (Node/Python API endpoints, background jobs, scheduled tasks). Use this skill whenever the user wants to rebuild, port, re-implement, or migrate Bubble workflows, backend logic, API workflows, scheduled or recurring events, database trigger events, or recursive workflows into real code, asks how to replace "Schedule API Workflow", Bubble email sending, or Bubble plugin actions like Stripe, or wants to move an app's business logic off Bubble — even if they don't say "migration" explicitly.
license: MIT
metadata:
  author: inovastudio
  version: "1.0.0"
---

# Bubble Workflows & Backend Logic Migration (Workflows → Server-Side Code)

Methodology for re-implementing Bubble.io workflows, backend workflows, and API workflows as server-side code. Covers the inventory method, construct-by-construct mapping, scheduling and queues, and parallel-run validation.

## 1. The Fundamental Constraint: No Workflow Export (design around this first)

- **There is no API that exports workflow definitions.** The Data API exports data only; workflows exist solely in the Bubble editor. Migration is therefore **re-implementation guided by a manual inventory**, never automated translation. Set this expectation with the user before estimating anything.
- What *is* inspectable: the editor (each page's Workflow tab, the Backend workflows page), the API Connector configuration (including stored API keys — extract them during inventory), plugin action configurations, and the Logs tab, which reveals which workflows actually fire in production and how often.
- Public API workflow endpoints live at `POST https://<app>.bubbleapps.io/api/1.1/wf/<workflow-name>` (or the custom domain). These are **external contracts** — Stripe webhooks, Zapier zaps, and partner integrations depend on the URLs. Preserve them (proxy/rewrite) or update every caller at cutover.
- Execution semantics to account for: actions run in declared order, but Bubble provides **no transactions and no rollback** — a failed step 4 leaves steps 1–3 committed, and searches inside a workflow may not see writes from earlier steps of the same workflow. Migrated code should *improve* on this with real DB transactions, but flag anywhere the app implicitly relied on Bubble's behavior.
- Workload units (WU) meter workflow runs; the WU/Logs dashboard doubles as a frequency signal for prioritizing the inventory.

## 2. Migration Pipeline

```
Inventory → Classification & Mapping → Re-implementation → Parallel-Run Validation
```

The inventory is a structured document — one row per workflow: trigger, "Only when" condition, ordered action list, data touched, scheduling metadata, external calls. Produce it by walking the editor page by page, then the Backend workflows page. Transcribe "Only when" conditions **verbatim**: they encode the business rules.

## 3. Stage 1 — Inventory

Capture per workflow:

- Trigger type and its "Only when" condition.
- Each action, with its "Result of step N" data flow between steps.
- The "ignore privacy rules" checkbox on backend workflows (these become privileged code paths).
- Scheduling metadata: delay, recurrence interval, "on a list" fan-outs.
- External calls: plugins, API Connector, email sends, webhooks registered elsewhere.
- Error handling: "An unhandled error occurs" workflows.

Classify frontend (page) workflows into two buckets:

1. **UI-only** — navigation, show/hide, set state. Stays in the rebuilt frontend; covered by the `bubble-ui-rebuild` skill.
2. **Data/business logic** — anything that creates or changes things, sends email, or calls APIs. Move it server-side even though Bubble ran it client-triggered; this is the key architectural upgrade of the migration.

## 4. Stage 2 — Mapping Table

| Bubble construct | Server-side target |
|---|---|
| API workflow (exposed) | HTTP endpoint (Express / FastAPI / Next.js route); preserve the `/wf/` URL contract or update callers |
| Backend workflow (internal) | Internal function / service-layer method |
| Schedule API Workflow (with delay) | Job queue with delayed jobs (BullMQ, pg_boss, Cloud Tasks) |
| Schedule API Workflow on a list | Fan-out batch job — one queued job per item |
| Recursive workflow (Bubble's loop substitute) | A plain loop or paginated batch job — do not port the recursion |
| Recurring event | Cron job (Bubble recurrence granularity is plan-gated; the cron version can be more frequent) |
| Database trigger event (thing created/changed/deleted) | App-level hooks in the service layer (preferred) or DB triggers; replicate the old-vs-new comparison Bubble exposes as "This Thing before change" |
| Custom event | Shared function |
| "Only when" condition | Guard clause |
| "Result of step N" | Local variable / awaited return value |
| Create / Make changes to / Delete a thing | Repository or ORM calls **inside a transaction** |
| Send email (Bubble's built-in sender) | Own provider (Resend, SES, Postmark) — Bubble's shared SendGrid sender does not migrate |
| Stripe / plugin actions | Direct SDK calls; re-register webhooks to the new endpoints |
| API Connector calls | Native HTTP calls; secrets move from the Connector to environment variables |

## 5. Stage 3 — Re-implementation Principles

- Target the database migrated by the `bubble-db-migration` skill. Bubble unique IDs as primary keys mean every thing reference in a workflow ports verbatim.
- Wrap multi-step mutations in transactions; add idempotency keys to webhook-triggered endpoints (Bubble callers and payment providers both retry).
- Re-implement authorization explicitly: backend workflows with "ignore privacy rules" become service-role code paths; everything else must check the caller. The authorization model itself is specified in the `bubble-auth-migration` skill.
- Keep endpoint request/response shapes identical to what Bubble returned wherever external callers exist.

## 6. Stage 4 — Parallel-Run Validation

- During gradual migration (Bubble still source of truth via the `bubble-db-migration` incremental sync), run new endpoints in **shadow mode**: fire both implementations, diff the resulting DB state on the synced copy.
- Write contract tests for preserved `/wf/` endpoints and replay real request payloads captured from Bubble's logs.
- Compare scheduled-job outcomes over at least one full recurrence cycle before cutover.

## 7. Risks & Edge Cases Checklist

1. **Hidden workflows** — "Do when condition is true" workflows and workflows inside reusable elements are easy to miss; walk every page *and* every reusable element.
2. **Already-scheduled future workflows** — `Schedule API Workflow` calls sitting in Bubble's scheduler at cutover; list them via the Scheduler log and drain or re-schedule them in the new queue.
3. **Third-party webhook URLs** pointing at `/api/1.1/wf/...` — cutover requires updating each caller or proxying the old URLs.
4. **Timezones** — Bubble evaluates dates in user/app timezones; cron re-implementations must pin timezones explicitly.
5. **Races Bubble masked** — queues and transactions change timing; workflows that happened to serialize in Bubble may now interleave.
6. **Black-box plugin actions** — server-side plugin actions have no visible source; characterize them by inputs/outputs from logs before re-implementing.
7. **Privacy-rule-filtered searches inside workflows** — "Do a search for" inside a workflow returned privacy-filtered results; the same query with service-role DB access returns more rows. Reconcile with the `bubble-auth-migration` inventory.

## 8. How to Apply This Skill

- **Full backend migration**: all four stages, prioritized by the WU/Logs frequency data.
- **Single workflow / endpoint port**: inventory just that workflow plus everything it schedules or triggers transitively.
- **UI-only workflow logic**: route to the `bubble-ui-rebuild` skill.
- Always produce the inventory document and a per-workflow mapping plan for user review **before writing code**.
- Run this against the database migrated (or synced) by the `bubble-db-migration` skill; authorization re-implementation is covered by the `bubble-auth-migration` skill.
