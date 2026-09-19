# Execution plan — Component Resolver

Source doc: .ai/specs/2026-09-19-component-resolver.md
Spec PR: #29 (merged, design-only)
Branch: feat/component-resolver
Engine: om-auto-create-pr (steps: 3, --loop: no)

## Goal

Add the component resolver: one pure function that decides which implementation of a contract
renders. It returns the user's usable preference, or otherwise core's default, and it always
returns core's default beside it as the fallback. The spec's Q1–Q4 decisions are owner-confirmed
and followed as written.

## Scope

- **New:** `packages/web/src/component-registry/resolve.ts` (`coreDefaultComponentId`,
  `resolveComponent`, `missingCoreDefaults` and their types) and `resolve.test.ts`.
- **Changed:** the "the components service" block of `packages/web/src/extensions/host.test.ts`,
  and the AGENTS.md "Component implementations" routing row.

## Non-goals

- No slot, no error boundary and no rendering. Core's defaults are not registered in `main.tsx`,
  and no core contract joins `CORE_COMPONENT_CONTRACTS` (spec Q1).
- No preference store and no picker. The preference is an argument (spec Q2).
- No `needs` argument for optional capabilities (spec Q4).
- No change to `registry.ts`, `main.tsx` or `packages/extension-api`, so `surface.test.ts` and
  `boundary.test.ts` stay unchanged. No HTTP, service or api-client change.

## Implementation Plan

### Phase 1: The resolver

1. `resolve.ts` per spec § Resolving, precisely, and its unit and type tests in `resolve.test.ts`
   (spec Implementation Plan step 1). The tests use the fixture `cezar.fixture.task-header@1` with
   core's default and compact implementations, and `acme.jira` and `acme.compact` through
   `fakeScope`.
2. `missingCoreDefaults` and its tests, including the negative case that shows the check can fail
   (spec step 2).

### Phase 2: The Definition of Done proof

3. The brief's example through the extension host in `host.test.ts` (`bootServingHeader`), and
   the AGENTS.md routing row (spec step 3).

## Risks

- The resolver has no production caller until the slot item. This is intended (spec § Risks).
- Core's default id convention `${contract.id}.default` becomes a rule (Q3, owner-confirmed).
  `coreDefaultComponentId` is the only place that spells it.
- The validation gate runs in Docker through the main checkout's untracked `in-docker.sh`,
  because host state breaks some server tests on WSL2.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The resolver

- [x] 1.1 resolveComponent and coreDefaultComponentId — 22473f18
- [x] 1.2 missingCoreDefaults — 466afbe1

### Phase 2: The Definition of Done proof

- [ ] 2.1 Host proof and routing row
