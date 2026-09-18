# Execution plan — land editable layout element discovery on current main (adopted from PR #12)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-09-19 because PR #12 carried no execution plan.
**PR:** #12 · **Branch:** `feat/editable-layout-elements-discovery` · **Base:** `main`
**Author:** @RafalDev4You — this plan interprets their intent; correct it by editing this file or commenting on the PR.

Source doc: `.ai/specs/2026-09-19-editable-layout-elements-discovery.md`

## 🎯 Goal

Make PR #12 mergeable onto current `main`: resolve the conflicts left by the squash-merge of the edit-mode interaction guard (#8), keep the PR scoped to layout element discovery, and pass the validation gate and review.

## Scope

- `packages/web/src/lib/layout-elements.ts` and its test — the typed registry.
- `packages/web/src/components/layout-registry.tsx`, `layout-element.tsx` and its test — the provider and the declarative wrapper.
- Merge resolution against `main` for the edit-mode guard files the branch carried as prerequisites.

## Non-goals

- Mounting the registry in a dashboard route (spec step 8): no dashboard layout exists yet, and the spec limits integration to that future layout.
- Geometry, drag-and-drop, resize, deletion, persistence, HTTP API — excluded by the spec.
- Any change to the edit-mode guard beyond taking `main`'s version during the merge.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The goal is the spec's Phase 1–3 discovery contract, client-only | PR body, `Source doc:` line; spec Implementation Plan | high |
| The feature code is already complete (spec steps 1–7, 9–11) | commit `ee4f18f5`; implementation review comment by @RafalDev4You (no blocking findings) | high |
| The remaining work is the conflict with `main` | PR mergeable state `CONFLICTING`; `main` squash-merged #8 over the branch's pre-squash guard commits | high |
| `main`'s side of the four conflicting files is a strict superset of the branch's | `git diff` branch → `main` only adds lines in all four files | high |
| The flat `.ai/runs/2026-09-18-global-edit-mode-interaction-guard.md` is a stale duplicate | `main` carries the same plan as the run folder `.ai/runs/2026-09-18-global-edit-mode-interaction-guard/` | high |

## Assumptions

- The PR body's `Source doc:` path (`2026-09-18-…`) is a typo for the spec that exists on `main` (`2026-09-19-…`); the content is the same spec.
- Spec step 8 stays deferred until a dashboard layout exists, as the PR body states; the author can pull it into scope by amending this plan.

## Risks

- Low: the change is client-only, unmounted, and additive; rollback is removing the three components and the library file.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Typed layout registry, provider, declarative wrapper and lifecycle tests — ee4f18f5

### Phase 2: Sync with main

- [x] 2.1 Merge main and resolve the edit-mode guard conflicts to main's version — e34ea7d2
- [ ] 2.2 Drop the stale flat run plan for #8 superseded by main's run folder

### Phase 3: Finish

- [ ] 3.1 Run the full validation gate
- [ ] 3.2 Authoritative review pass and fixes
