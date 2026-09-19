# Execution plan — implement Component Settings API

**Source doc:** `.ai/specs/2026-09-19-component-settings-api.md`
**Base:** `main`

## 🎯 Goal

Implement implementation-owned component settings with declarative boolean definitions, host-owned
validation and persistence, global/project scope selection, and a type-safe implementation reader.

## Scope

- Extend the node/DOM-free extension API with `defineSettings`, `booleanSetting`, `SettingsOf`, and
  the implementation-only settings reader.
- Add registry-owned settings semantics and a scope-aware web adapter over existing UI-state routes.
- Hydrate settings in `ComponentHost`, including stale-read and fallback behavior.
- Extend both UI-state contracts additively and update the required documentation.

## Non-goals

No settings picker, form generator, new HTTP route, layered global/project override model, secrets
store, or changes to task/session/runner behavior.

## Risks

This crosses the public extension contract, browser registry, persistence state and React host. The
implementation must preserve the node-free extension boundary, tolerate unavailable storage, and
avoid painting values from a previous implementation or project after an async switch.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Extension contract and in-memory registry

- [x] 1.1 Add the declarative settings API and boundary/type coverage. — d0df71bc
- [x] 1.2 Snapshot settings definitions and implement host read/write/reset semantics. — d0df71bc

### Phase 2: Scope-aware durable store

- [x] 2.1 Extend workspace and project UI-state contracts additively. — d0df71bc
- [x] 2.2 Implement the global/project UI-state adapter and wire the default boot path. — d0df71bc

### Phase 3: Component host integration

- [x] 3.1 Expose the implementation-specific settings reader in `ComponentHost`. — d0df71bc
- [x] 3.2 Cover switching, project scope, fallback and async failure behavior. — d7bdd934

### Phase 4: Documentation and validation

- [x] 4.1 Document the durable contract and compatibility surface. — d0df71bc
- [x] 4.2 Run the full configured validation gate and focused suites. — d7bdd934

Validation: `npm run typecheck`, `npm test` (433 files / 8,140 tests), `npm run test:unit`,
`npm run build`, and `npm run test:package` all pass. Focused extension-api and component-registry
suites also pass. No browser QA is required: the spec adds no visible settings UI or new route.
