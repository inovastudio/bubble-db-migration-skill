---
name: bubble-ui-rebuild
description: Methodology for rebuilding a Bubble.io app's pages, elements, and responsive layouts in a modern frontend framework (React, Next.js, Vue, Svelte). Use this skill whenever the user wants to rebuild, recreate, port, or migrate Bubble pages, repeating groups, popups, reusable elements, custom states, conditionals, or the Bubble responsive engine into real frontend code, asks how to replace "Do a search for", "Current User", or "Current cell" data bindings, or wants to move a Bubble app's UI off Bubble — even if they don't say "rebuild" explicitly.
license: MIT
metadata:
  author: inovastudio
  version: "1.0.0"
---

# Bubble UI / Frontend Rebuild (Bubble Pages → Modern Frontend)

Methodology for re-creating a Bubble.io app's user interface in a modern frontend framework. Covers the inventory method, element and data-binding mapping, responsive-engine translation, and parity expectations.

## 1. The Fundamental Constraint: No UI Export (design around this first)

- **Bubble apps have no source export** — no HTML/CSS export and no page-definition API. The rendered DOM is Bubble-runtime output and is not a usable rebuild source. Rebuild = re-creation guided by a structured inventory from the editor plus screenshots of the running app.
- What *is* extractable: the editor's element tree per page, the Styles tab (design tokens), option sets (display values only, via data), the rendered app for visual reference, and SEO/meta settings per page.
- **Two responsive engines exist.** The new engine is flexbox-based (row/column/align-to-parent containers, min/max width and height, gaps, "collapse when hidden") and maps almost 1:1 to CSS flexbox. The legacy engine (fixed coordinates plus hiding rules) does not — redesign legacy pages to flexbox, never replicate coordinates.
- Bubble is page-based but heavily uses the **single-page-with-hidden-groups idiom**. Decide the routing architecture up front: hidden-group "views" usually become real routes.
- Set the parity contract early: **behavioral parity, not pixel parity.**

## 2. Rebuild Pipeline

```
Page & Component Inventory → Design Token Extraction → Data-Binding Map → Implementation → Parity Check
```

## 3. Stage 1 — Inventory

Per page, capture:

- Page **"type of content"** — it drives the route shape (`/product/[id]`) and the page's root data dependency.
- The element tree: groups → repeating groups → leaf elements, with each element's conditionals ("when … change …").
- **Reusable elements first** — they become the shared component library and gate everything else.
- Popups, floating groups, and group-focus elements.
- Custom states (element-scoped, non-persistent) and URL parameters read via "Get data from page URL".
- Plugin elements (charts, calendars, rich-text editors) — inventory each one explicitly; npm-equivalent availability gates feasibility.

## 4. Stage 2 — Element Mapping Table

React/Next.js shown; adapt per framework:

| Bubble | Frontend equivalent |
|---|---|
| Page (with type of content) | Route with dynamic segment (`/product/[id]`) |
| Reusable element | Shared component |
| Group | `div` + flex container |
| Repeating group | List component + paginated query; "full list" vs "ext. vertical scroll" drives pagination vs infinite scroll |
| Popup | Modal/dialog (portal) |
| Floating group | Fixed/sticky positioned element |
| Custom state | Component state (`useState`) or URL state — custom states are non-persistent, which validates this mapping |
| Conditional on element | Conditional render / conditional class |
| Style (Styles tab) | Design tokens (CSS variables / Tailwind theme) |
| Option set in UI (dropdowns, labels, colors) | TypeScript enum / const map — option set definitions are not exportable via API; transcribe from the editor |
| Plugin element | npm equivalent, chosen per plugin during inventory |
| HTML element / page header code | Direct port |

## 5. Stage 3 — Data-Binding Map (the hard 20%)

- **"Do a search for X with constraints"** → a query hook (React Query/SWR) against the migrated database's API layer. Flag Bubble **Advanced Filters** explicitly — they run client-side in Bubble after fetching; decide per case whether to push them into SQL.
- **"Current User"** → the auth context/session provider from the `bubble-auth-migration` skill.
- **"Current cell's Thing" / "Parent group's Thing"** → props and component context.
- **Privacy-rule-driven invisibility** — Bubble UIs silently rely on privacy rules to empty repeating groups; in the rebuild this must become explicit query filters or RLS (see the `bubble-auth-migration` skill), or previously hidden data leaks.
- **Input autobinding** (save-on-change) → explicit mutation with debounce; note autobinding also depended on the privacy rules' "allow autobinding" grant.
- **Live updates** — Bubble repeating groups update in near-realtime for free; decide polling vs subscriptions (e.g., Supabase Realtime) per view. Realtime parity is a product decision with real cost, not a default.

## 6. Stage 4 — Implementation Strategy

- Build reusable elements (the component library) first, then pages ordered by traffic/business priority.
- Wire the rebuild to the **synced database copy** from the `bubble-db-migration` skill so development proceeds while the Bubble app stays live; server endpoints come from the `bubble-workflows-migration` skill.
- Keep only presentation logic client-side; any page workflow that mutates data belongs to the `bubble-workflows-migration` inventory.

## 7. Risks & Edge Cases Checklist

1. **Legacy responsive engine pages** — redesign to flexbox; replicating coordinates produces brittle layouts.
2. **Hidden-group SPA idioms** — convert to real routes; preserve URL contracts only where links are public or bookmarked.
3. **Workflow logic embedded in the UI** — misclassifying business logic as UI logic is the top source of rebuild bugs; when in doubt, it goes server-side.
4. **Bubble-hosted images** in styles and elements — never hardcode `appforest_uf` URLs in the rebuilt UI; coordinate with the `bubble-files-migration` skill.
5. **SEO parity** — Bubble apps often rank; capture page titles, meta descriptions, slugs, and the sitemap before the rebuild, and plan redirects.
6. **Plugin elements with no npm equivalent** — surface these in the inventory phase; they can gate feasibility or force scope changes.
7. **Pixel-parity expectations** — restate the behavioral-parity contract whenever stakeholders review screens.

## 8. How to Apply This Skill

- **Full rebuild**: all stages; component library first, then pages by priority.
- **Single-page port**: inventory that page plus every reusable element and binding it touches.
- **Component-library-first**: stages 1–2 scoped to reusable elements and styles only.
- Always produce the page inventory and data-binding map for user review **before writing components**.
- Data layer comes from the `bubble-db-migration` skill, endpoints from `bubble-workflows-migration`, session/user context and access rules from `bubble-auth-migration`, and asset URLs from `bubble-files-migration`.
