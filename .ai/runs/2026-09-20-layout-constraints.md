# Execution plan - implement Layout Constraints (adopted from PR #69)

**Origin:** adopted - reconstructed by `om-auto-continue-pr` on 2026-09-20 because PR #69 carried no execution plan.
**PR:** #69 · **Branch:** `spec/layout-constraints` · **Base:** `main`
**Author:** @RafalDev4You - this plan interprets the PR's intent; correct it by editing this file or commenting on the PR.

## Goal

Implement the layout-constraint design from `.ai/specs/2026-09-20-layout-constraints.md`: validated immutable component policy, one pure admission validator, and atomic enforcement across page admission, rendering, drag/drop, and deletion without changing the layout wire format or adding a live-page migration.

## Scope

- Extend the extension API component contract with `movable`, `removable`, `replaceable`, `allowedZones`, and `category` metadata.
- Add shared web-side layout validation and apply it to page content, rendering, and edit-mode mutations.
- Preserve legacy descriptors, existing implementation preferences, serialized `LayoutSchema`, HTTP/server behavior, and zero-config operation.
- Add focused regression tests and update the relevant project documentation.

## Non-goals

- No persistence or `LayoutSchema` version change.
- No HTTP route, server state, extension service, permission, account, or user-config change.
- No live Task Page migration beyond the explicit core declaration/fixture requested by the spec.
- No implementation-preference behavior change and no QA approval claim without browser evidence.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The PR's intended deliverable is the Layout Constraints implementation described by the spec. | PR title/body, `Source doc`, and `.ai/specs/2026-09-20-layout-constraints.md` | high |
| The existing branch contains only the design document. | PR diff and commit `bd597c98` | high |
| The implementation phases and acceptance criteria are the spec's own. | Spec sections `Phasing`, `Implementation Plan`, and `Acceptance Criteria` | high |
| Previous validation was recorded as skipped for the design-only PR, but implementation validation remains required. | PR body and repository validation contract | high |

## Assumptions

- This resume adopts the implementation intent because the PR's own final comment directs implementation through `om-auto-implement-spec`; it does not widen the stated scope.
- The spec's autonomous defaults are authoritative unless existing repository contracts make a narrower implementation necessary.
- Every new code change includes tests, and the configured validation gate runs before completion.
- Browser verification is reported as unavailable unless `.ai/qa/test-env.json` becomes available; no QA label is inferred from that absence.

## Risks

The public component-definition shape and layout mutation seams are compatibility-sensitive. Validator drift between page admission, rendering, and edit-mode operations is the primary correctness risk. The spec states that the live page migration and persisted-layout changes remain separate follow-up work.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Design already landed on this PR

- [x] 1.1 Add the Layout Constraints design specification and implementation breakdown — bd597c98

### Phase 2: Public component policy

- [ ] 2.1 Extend the extension API component contract with validated, frozen policy metadata and regression tests.
- [ ] 2.2 Update the extension API surface, README, and contract tests for layout policy versus implementation preferences.

### Phase 3: Shared validator and page admission

- [ ] 3.1 Add the pure layout operation/result validator with stable issue ordering and focused unit tests.
- [ ] 3.2 Apply shared admission checks to `PageLayoutRegistry` and `PageRenderer` without cross-zone fallback.
- [ ] 3.3 Add page-layout and required-zone regression coverage proving rejected operations do not mutate snapshots.

### Phase 4: Edit-mode mutation guard

- [ ] 4.1 Preserve normalized contract policy and zone identity on contract-backed layout descriptors while keeping legacy descriptors compatible.
- [ ] 4.2 Implement atomic `tryMoveNode` and `tryRemoveNode` operations with compatibility wrappers and subtree validation.
- [ ] 4.3 Route sortable surfaces and context-menu deletion through the result seam, including accessible rejection states and interaction tests.

### Phase 5: Core declarations and handoff

- [ ] 5.1 Add explicit policy to the first core component consumer and test allowed zones, replacement, and required-zone deletion.
- [ ] 5.2 Update project guidance/spec references, run the full validation gate, and document browser verification limits.
