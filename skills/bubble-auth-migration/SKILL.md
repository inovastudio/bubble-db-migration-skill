---
name: bubble-auth-migration
description: Methodology for migrating Bubble.io user accounts, authentication, and privacy rules to an external auth provider (Supabase Auth, Auth0, Clerk, custom) with row-level security. Use this skill whenever the user wants to migrate Bubble users, logins, passwords, sessions, OAuth/social logins, or privacy rules off Bubble, asks how to handle Bubble's non-exportable password hashes, wants to translate Bubble privacy rules into Postgres RLS policies, or is planning the auth cutover for a Bubble migration — even if they don't say "migration" explicitly.
license: MIT
metadata:
  author: inovastudio
  version: "1.0.0"
---

# Bubble Auth & Privacy Rules Migration (Bubble Users → External Auth + RLS)

Methodology for migrating Bubble.io user accounts, credentials, and privacy rules to an external auth provider with row-level security. Covers the password-hash constraint, credential strategies, the privacy-rules-to-RLS mapping, and cutover sequencing.

## 1. Auth Constraints (design around these first)

- **Password hashes are not exportable — full stop.** Bubble provides no access to password hashes through any API or export. Every migration strategy below is a workaround; present them honestly and let the user choose. Never let a plan imply hashes can be obtained.
- What *is* exportable (admin Data API token, User type exposed): user records with `_id`, Created Date, custom fields, and email — which the Data API nests as `authentication.email.email`, a Bubble quirk to handle explicitly. Email-confirmed status is available; OAuth-linked identity details largely are not.
- **Sessions do not transfer.** All users re-authenticate at cutover regardless of strategy; plan communications accordingly.
- **Privacy rules** are per-datatype role rules ("When: Current User is this Thing's Creator") granting: find-in-searches, view-all-fields or per-field visibility, view attached files, and allow-autobinding. They gate both the app UI and the Data API. They map conceptually to row-level security, with one structural mismatch (per-field visibility — see section 5).
- Bubble's **"Current User"** is the universal authorization primitive; the entire mapping exercise is re-expressing "Current User" conditions against the new auth identity.

## 2. Migration Architecture

```
User Export & Identity Map → Credential Strategy → Privacy-Rule Inventory → RLS Implementation → Cutover
```

Foundation: the users table synced by the `bubble-db-migration` skill (Bubble `_id` as primary key). Build an **identity map** between Bubble user IDs and new auth IDs. Recommended shape: a `profiles` table keyed by Bubble `_id` with an `auth_id` column — every existing foreign key in the migrated database stays valid untouched. Stuffing Bubble IDs into auth-provider metadata works but makes the mapping harder to join against.

## 3. Credential Strategies (the core decision)

| Strategy | How | Trade-off |
|---|---|---|
| **Forced reset** | Pre-create accounts with unusable passwords; at cutover, email all users a set-password link | Simplest and safest; login friction, email-deliverability risk, dormant-user churn |
| **Dual-login bridge** | New login tries the new provider first; on failure, verifies credentials against Bubble via a dedicated, locked-down API workflow that attempts "Log the user in" and returns success/failure; on success, set that password in the new provider and mark the user migrated | Zero user friction; requires keeping Bubble running during a bridge window, and the bridge endpoint is a **credential oracle** — rate-limit it, log it, time-box it |
| **Passwordless cutover** | Switch to magic-link / OTP login keyed on email | Sidesteps passwords entirely; a product-level change that needs buy-in |

OAuth/social users: re-link by verified email in the new provider (same email from the same IdP → same user); enumerate and handle email-mismatch cases explicitly rather than silently creating duplicates.

## 4. Privacy-Rule Inventory

There is no export API for privacy rules either — **transcribe every datatype's rules from the editor**. Capture per rule: the role condition (verbatim), each grant checkbox (find in searches / view all fields / per-field list / view attached files / allow autobinding), and the "Everyone else" default. Also inventory where the app relied on privacy rules *implicitly* — searches whose results were silently filtered — and reconcile with the `bubble-workflows-migration` and `bubble-ui-rebuild` inventories.

## 5. Mapping Table: Privacy Rules → RLS (Postgres/Supabase shown)

| Bubble | Target |
|---|---|
| "Current User" | `auth.uid()` resolved to the Bubble `_id` via the identity map (e.g., a `current_bubble_user_id()` SQL helper) |
| "This Thing's Creator" | `created_by` column (migrated by the `bubble-db-migration` skill) compared to the current user |
| Role condition ("Current User's role is admin") | JWT claim or role column checked in the policy's `USING` clause |
| "Find this in searches" | RLS `SELECT` policy (`USING`) |
| "View all fields" | Same `SELECT` policy — but see the per-field row below |
| **Per-field visibility** | **No RLS equivalent** — RLS is row-level. Options: column-level `GRANT`s, a `SECURITY DEFINER` view exposing allowed columns, or splitting sensitive fields into a stricter side table. Surface this mismatch per affected datatype; do not paper over it |
| "View attached files" | Storage policies — private buckets + signed URLs, designed with the `bubble-files-migration` skill |
| Allow autobinding | `UPDATE` policy with `WITH CHECK` |
| Backend workflow "ignore privacy rules" | Service-role / `SECURITY DEFINER` code paths — enumerate them and keep the list minimal |
| "Everyone else" with no grants | Default-deny: RLS enabled with no permissive policy |

Guiding principle: **default-deny everywhere, then add one permissive policy per transcribed rule.** Bubble's model is additive grants, which translates cleanly to permissive RLS policies.

## 6. Cutover Sequencing

1. Pre-create auth accounts from the synced users table — **idempotent and re-runnable per sync cycle**, because new Bubble signups keep arriving until cutover.
2. RLS policies in place and tested against the synced copy.
3. Credential strategy live (bridge deployed, or reset emails staged).
4. Frontend/DNS cutover.
5. Bridge window (if dual-login), then close it.
6. Decommission checklist — gated on `bubble-files-migration` completion (Bubble deletes files when the app closes).

## 7. Risks & Edge Cases Checklist

1. **Claiming password migration is possible** — it is not; audit any plan that implies otherwise.
2. **The dual-login bridge is attack surface** — rate limit, alert on volume, and time-box the window.
3. **Per-field privacy silently dropped** in an RLS-only port — the most common correctness regression of these migrations; call it out per datatype.
4. **Users created mid-migration** — account pre-creation must be a repeatable job, not a one-shot.
5. **Reset-email deliverability at blast scale** — warm up the sender, batch, monitor bounces.
6. **Duplicate or shared emails** in Bubble user tables (Bubble tolerates odd states) — define a dedupe policy before pre-creation.
7. **"Current User" appears in both workflow conditions and privacy rules** — same expression, two migration homes (`bubble-workflows-migration` vs this skill); reconcile the two inventories.
8. **RLS testing is a required deliverable** — write per-policy tests impersonating users (e.g., setting `request.jwt.claims` in Supabase tests). Bubble gave no such harness; the migration must.

## 8. How to Apply This Skill

- **Users-only export**: sections 1–2 (plus the `bubble-db-migration` skill for the sync itself).
- **Privacy-rules-to-RLS design only**: sections 4–5.
- **Full auth cutover**: all sections in order.
- Always produce the credential-strategy recommendation, the privacy-rule transcript, and the RLS plan for user review **before implementation**.
- Builds on the synced users table from the `bubble-db-migration` skill; storage access policies are designed with the `bubble-files-migration` skill.
