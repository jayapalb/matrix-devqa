# Finding — Layout controls have no accessible name (a11y)

- **Severity:** Med
- **Area:** Planner UI · Layouts (§09)
- **Status:** open → codified as a regression test (`planner-ui.spec.mjs @a11y`)
- **Found by:** qa-bughunter (adversarial a11y pass), 2026-07-03

## Summary

The layout **intent** selector (Focus / Image cockpit / Balanced /
Collaboration / Review) and the window-inspector display/source selectors are
bare `<select>` elements with no `<label>`, `aria-label`, `aria-labelledby`, or
`title`. A screen-reader user hears "combo box, focus-primary" with no idea
what the control governs. WCAG 2.1 **4.1.2 / 3.3.2** (form elements must have
names/labels).

## Reproduction

1. Open the planner UI (`http://localhost:15500`), click **09 Layouts**.
2. Inspect the intent `<select>` under each layout row → no accessible name.
   (Or run the a11y probe: 5 unlabeled form fields on this surface.)

## Evidence

- 5 `<select>` controls with no name/label/placeholder; sample values
  `focus-primary`, `image-cockpit`, `balanced`, `collaboration`, `review`.
- Screenshots: `.qa/artifacts/findings/bughunt/09_Layouts.png`.

## Suspected root cause

- `matrix-planner/apps/web/src/modules/layouts/LayoutList.tsx:44` — the intent
  `<select>` has `style`/`onChange` but no `aria-label`.
- `matrix-planner/apps/web/src/modules/layouts/WindowInspector.tsx:59,71,115` —
  the display/source/policy selects, same pattern.

## Recommended fix (for a developer — bughunter does not edit app source)

Add an `aria-label` to each control describing what it sets, e.g.
`aria-label={`Layout intent for ${l.label}`}` on the LayoutList select, and
`aria-label="Display for this window"` / `"Source for this window"` on the
WindowInspector selects.

## Also observed (Low, not filed separately)

- ~87px horizontal overflow at 390px viewport across most sections. The planner
  is a desktop / OR-wall tool (not a mobile target), so this is low priority —
  noted, not escalated.

## Investigated and DISMISSED (false positive)

- Rapid triple-click "Add source" produces a `412 Precondition Failed` +
  browser console error. **Not a bug:** the server's optimistic-concurrency
  (`If-Match` on `rev`) is correct, and the client (`useRoomSave.ts:76`)
  catches 412 and reconciles. Empirically, all 3 rapid adds persist — no data
  lost. The console line is Chromium's built-in network log for a *handled*
  412, not an app error. Codified as a **guard** (`@ux rapid-add persists`) so
  it stays correct.
