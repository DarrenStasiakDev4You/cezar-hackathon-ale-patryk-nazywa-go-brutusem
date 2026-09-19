# Component Capability Validation implementation

Goal: make component capability results reusable by the registry and expose one read model whose choices exactly match the resolver.

Source doc: `.ai/specs/2026-09-19-component-capability-validation.md`

## Scope

- Extend extension-api compatibility results with missing and custom capability lists.
- Record those lists in component registrations and add the pure `listComponentChoices` read model.
- Add focused regression and integration-style host tests, update the extension API documentation, and document the registry contract in `AGENTS.md`.

Non-goals: settings UI, stored preferences, HTTP routes, persisted data, or changes to resolver behavior.

## Risks

- The extension API and registration shapes are shared across package boundaries; all construction sites and whole-object assertions must be updated together.
- The choices model must remain derived from `resolveComponent`, with deterministic sorting and no second capability comparison.

## Implementation Plan

### Phase 1: Capability validation's read side

- [x] 1.1 Add `missingCapabilities` and `customCapabilities` to compatibility results, update TSDoc/README, and add compatibility regression tests. — 87709910
- [ ] 1.2 Record capability lists on registry registrations, preserve unknown-contract behavior, and add registry regression tests.
- [ ] 1.3 Add `listComponentChoices` with resolver agreement, deterministic grouping, and focused choices tests.
- [ ] 1.4 Add extension-host Definition of Done coverage and update the extension API README and `AGENTS.md` guidance.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Capability validation's read side

- [ ] 1.1 Add `missingCapabilities` and `customCapabilities` to compatibility results, update TSDoc/README, and add compatibility regression tests.
- [ ] 1.2 Record capability lists on registry registrations, preserve unknown-contract behavior, and add registry regression tests.
- [ ] 1.3 Add `listComponentChoices` with resolver agreement, deterministic grouping, and focused choices tests.
- [ ] 1.4 Add extension-host Definition of Done coverage and update the extension API README and `AGENTS.md` guidance.
