# Execution plan - implement Layout Constraints

## Goal

Implement `.ai/specs/2026-09-20-layout-constraints.md` against `main`: add immutable component layout policy, a shared pure validator, and atomic enforcement across page admission, rendering, drag/drop, and deletion without changing serialized layout data or adding a live-page migration.

## Scope

- Extend the extension API component contract with validated `movable`, `removable`, `replaceable`, `allowedZones`, and `category` metadata.
- Add shared web-side layout operation validation and use it for page content, rendering, and edit-mode mutations.
- Preserve legacy descriptors, implementation preferences, serialized `LayoutSchema`, HTTP/server behavior, and zero-config operation.
- Add focused regression tests and update the relevant repository guidance.

## Non-goals

- No persistence or `LayoutSchema` version change.
- No HTTP route, server state, extension service, permission, account, or user-config change.
- No live Task Page migration beyond the explicit core declaration/fixture requested by the spec.
- No implementation-preference behavior change and no UI QA claim in this run.

## Risks

The public component-definition shape and layout mutation seams are compatibility-sensitive. Validator drift between page admission, rendering, and edit-mode operations is the primary correctness risk. Existing legacy descriptors must remain behaviorally compatible, while constrained descriptors must reject stale or unsupported mutations atomically.

Source doc: .ai/specs/2026-09-20-layout-constraints.md

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Public component policy

- [ ] 1.1 Extend the extension API component contract with validated, frozen policy metadata and regression tests.
- [ ] 1.2 Update the extension API surface, README, and contract tests for layout policy versus implementation preferences.

### Phase 2: Shared validator and page admission

- [ ] 2.1 Add the pure layout operation/result validator with stable issue ordering and focused unit tests.
- [ ] 2.2 Apply shared admission checks to `PageLayoutRegistry` and `PageRenderer` without cross-zone fallback.
- [ ] 2.3 Add page-layout and required-zone regression coverage proving rejected operations do not mutate snapshots.

### Phase 3: Edit-mode mutation guard

- [ ] 3.1 Preserve normalized contract policy and zone identity on contract-backed layout descriptors while keeping legacy descriptors compatible.
- [ ] 3.2 Implement atomic `tryMoveNode` and `tryRemoveNode` operations with compatibility wrappers and subtree validation.
- [ ] 3.3 Route sortable surfaces and context-menu deletion through the result seam, including accessible rejection states and interaction tests.

### Phase 4: Core declarations and handoff

- [ ] 4.1 Add explicit policy to the first core component consumer and test allowed zones, replacement, and required-zone deletion.
- [ ] 4.2 Update project guidance/spec references, run the full validation gate, and document browser verification limits.
