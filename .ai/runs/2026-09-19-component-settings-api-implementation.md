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

- [ ] 1.1 Add the declarative settings API and boundary/type coverage.
- [ ] 1.2 Snapshot settings definitions and implement host read/write/reset semantics.

### Phase 2: Scope-aware durable store

- [ ] 2.1 Extend workspace and project UI-state contracts additively.
- [ ] 2.2 Implement the global/project UI-state adapter and wire the default boot path.

### Phase 3: Component host integration

- [ ] 3.1 Expose the implementation-specific settings reader in `ComponentHost`.
- [ ] 3.2 Cover switching, project scope, fallback and async failure behavior.

### Phase 4: Documentation and validation

- [ ] 4.1 Document the durable contract and compatibility surface.
- [ ] 4.2 Run the full configured validation gate and focused suites.
