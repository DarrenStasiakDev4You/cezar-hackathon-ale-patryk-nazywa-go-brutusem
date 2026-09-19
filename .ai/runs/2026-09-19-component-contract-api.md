# Execution plan — Component Contract API

**Branch:** `feat/component-contract-api` · **Base:** `main`

Source doc: `.ai/specs/2026-09-19-component-contract-api.md` (spec PR #19, merged)

## 🎯 Goal

A component contract declares its required and optional capabilities and optional layout metadata, an implementation declares the capabilities it honours, and one pure function, `checkComponentCompatibility`, answers "does this implementation fit this contract?" from data alone — the same way for core's default and for an extension's replacement.

## Scope

- `packages/extension-api/src/components.ts`: `ComponentCapability`, `ComponentLayout`, `ComponentContractOptions`; the richer `ComponentContract` token and its validation in `defineComponentContract`; `ComponentImplementation.capabilities`.
- `packages/extension-api/src/compatibility.ts` (new): `checkComponentCompatibility`, `ComponentCompatibility`, `ComponentCompatibilityIssue`.
- `packages/extension-api/src/index.ts`: re-exports; `test/surface.test.ts` gains `checkComponentCompatibility`.
- Tests: `components-storage.test.ts`, new `compatibility.test.ts`, `example.test.ts`.
- `examples/hello-extension`: `Greeting` requires `greets-by-name`; the loud implementation declares it.
- Docs: `packages/extension-api/README.md` ("Replacing a component", status paragraph), one clause in AGENTS.md's Extensions routing row.

## Non-goals

- The three core task contracts (`cezar.task.header`, `.timeline`, `.composer`) — they land with the slot item (spec Q1).
- `context.components` host service, slot rendering, applying `layout`, the implementation picker.
- Host permissions as capabilities; a `defineComponentImplementation` helper; compile-time capability names.
- Any change in `packages/web`, the server, the contract or the api-client — except the one-line gate fix below, which removes a duplicate JSX attribute already on `main`.
- `BACKWARD_COMPATIBILITY.md` (the package is private; it gains a section only at publication).

## Risks

- Tokens made by `defineComponentContract` gain `requiredCapabilities: []` and `optionalCapabilities: []`; every `toEqual` on a token must be updated in the same step (`components-storage.test.ts`, `example.test.ts`).
- The check must stay total against hostile input (getters, revoked proxies); each field is read once inside its own `try`.
- The gate runs inside Docker (`in-docker.sh`, operator-local config) because host-side WSL2 leaks fail 8 server tests.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The richer contract

- [x] 1.1 Capability and layout types, and their validation in defineComponentContract — 4ea5253d
- [x] 1.2 Type tests for the richer contract — 230af702

### Phase 2: Implementations and the check

- [x] 2.1 capabilities on ComponentImplementation — 734d688b
- [x] 2.2 checkComponentCompatibility and its result types — 6df36b6f
- [x] 2.3 Core and extension on one contract — 787bf3fe

### Phase 3: Public surface and documentation

- [x] 3.1 Export and pin the surface — d6730151
- [x] 3.2 Example extension declares and passes the check — 55463e73
- [x] 3.3 Docs: README and AGENTS.md — 9892155f
- [x] Gate fix: drop the duplicate `data-edit-mode-action` that 3eaa75e7 left on main's edit-mode exit button (TS17001 failed `npm run typecheck`) — 5c673d1c
