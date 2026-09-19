# Execution plan — Component Registry

Source doc: .ai/specs/2026-09-19-component-registry.md
Spec PR: #26 (merged, design-only)
Branch: feat/component-registry
Engine: om-auto-create-pr (steps: 5, --loop: no)

## Goal

Replace the `context.components` placeholder with the cockpit's component registry. It records
every implementation of a component contract, from core and from extensions, with its provenance
and fit. The spec's Q1–Q4 decisions are owner-confirmed and followed as written.

## Scope

- **New:** `packages/web/src/component-registry/registry.ts` (pure module), `core-contracts.ts`
  (empty `CORE_COMPONENT_CONTRACTS`), `registry.test.ts`.
- **Changed:** `packages/web/src/extensions/host.ts` (`cockpitServices` takes `components`),
  `packages/web/src/main.tsx` (creates the registry), `packages/web/src/extensions/host.test.ts`.
- **Docs only:** `packages/extension-api/src/components.ts` and `errors.ts` TSDoc,
  `packages/extension-api/README.md`, and an AGENTS.md Task routing row.

## Non-goals

- No slot rendering, no picker, no Settings UI, and no core `cezar.task.*` contract (spec Q1).
- No `subscribe`/change notifications (spec Q4).
- No new public runtime export in `@open-mercato/cezar-extension-api`, so `surface.test.ts` and
  `boundary.test.ts` stay unchanged.
- No HTTP, service or api-client change.

## Implementation Plan

### Phase 1: The registry, core side

1. Types, catalog and error: `registry.ts` with the public types, `ComponentError`,
   `logComponentDiagnostic`, and `createComponentRegistry` with catalog validation.
   `core-contracts.ts` ships an empty catalog. Unit tests per spec step 1.
2. Core `register`, `list`, `listUsable`, `get` and disposal, with duplicate detection and deep
   freezing. Unit and type tests per spec step 2.

### Phase 2: The extension view and its wiring

3. `forExtension(scope).provide` per spec § Providing, precisely: the namespace check, the recorded
   fit, one diagnostic per unusable registration, and `scope.track()`. Unit tests with `fakeScope`.
4. Wire it into the host: `cockpitServices({ commands, events, components })` and `main.tsx`.
   `host.test.ts` gets the definition-of-done proof on the fixture contract
   `cezar.fixture.task-header@1`.

### Phase 3: Documentation

5. Extension API TSDoc (`ComponentRegistry`, `ExtensionErrorCode`), the README ("Replacing a
   component" and "Errors") and the AGENTS.md routing row.

## Risks

- `cockpitServices` gains a required dependency. Its only callers are `main.tsx` and
  `host.test.ts`, and both change in step 4.
- "Record, don't throw" becomes extension-facing behaviour (spec Q3, owner-confirmed).
- The validation gate runs in Docker through the main checkout's untracked `in-docker.sh`,
  because host state breaks some server tests on WSL2.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The registry, core side

- [x] 1.1 Types, catalog and error — 51341f8a
- [x] 1.2 Core register, list, listUsable, get, disposal — 1f3c4441

### Phase 2: The extension view and its wiring

- [x] 2.1 forExtension(scope).provide — 8d44bcde
- [x] 2.2 Wire it into the host — eb43d266

### Phase 3: Documentation

- [ ] 3.1 Extension API docs and routing
