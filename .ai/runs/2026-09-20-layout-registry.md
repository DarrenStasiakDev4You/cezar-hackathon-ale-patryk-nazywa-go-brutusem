# Layout Registry implementation

Goal: add a reusable, declarative page-and-zone registry so page definitions own their accepted component contracts and the renderer remains generic.

Source doc: `.ai/specs/2026-09-20-layout-registry.md`

## Scope

- Add the web package's page-layout definitions, registry, generic React renderer, and the declarative `TaskPage` catalog entry.
- Reuse existing extension component-contract ids and `ComponentHost` for rendering.
- Keep the registry in memory and expose a small subscription/revision API for future React consumers.

## Non-goals

- Do not migrate the live task-thread route or change its visual composition.
- Do not add HTTP routes, persistence, `context.pages`, or a new extension API package contract.
- Do not modify the existing DOM edit-mode `LayoutRegistry`.

## Risks

- The page-layout registry is a new shared web abstraction; malformed definitions must be rejected atomically and snapshots must not be mutable.
- The generic renderer must preserve the existing component registry's compatibility and fallback behavior.

## Implementation Plan

### Phase 1: Declarative model and registry

- [ ] 1.1 Add page, zone, content and validation types with immutable snapshots.
- [ ] 1.2 Implement the in-memory `PageLayoutRegistry` with atomic registration, lookup, validation, subscriptions and revisions.

### Phase 2: Generic rendering and catalog

- [ ] 2.1 Add `PageRenderer` and `ZoneRenderer` backed by `ComponentHost`, with required-zone error and optional-zone empty states.
- [ ] 2.2 Add the declarative `TaskPage` catalog definition and public page-layout exports.

### Phase 3: Verification

- [ ] 3.1 Add unit tests covering registry invariants, validation and renderer behavior.
- [ ] 3.2 Run the repository validation gate and prepare the implementation PR.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Declarative model and registry

- [ ] 1.1 Add page, zone, content and validation types with immutable snapshots.
- [ ] 1.2 Implement the in-memory `PageLayoutRegistry` with atomic registration, lookup, validation, subscriptions and revisions.

### Phase 2: Generic rendering and catalog

- [ ] 2.1 Add `PageRenderer` and `ZoneRenderer` backed by `ComponentHost`, with required-zone error and optional-zone empty states.
- [ ] 2.2 Add the declarative `TaskPage` catalog definition and public page-layout exports.

### Phase 3: Verification

- [ ] 3.1 Add unit tests covering registry invariants, validation and renderer behavior.
- [ ] 3.2 Run the repository validation gate and prepare the implementation PR.
