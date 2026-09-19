# Execution plan — Component Host, PR 1 (the host)

Source doc: .ai/specs/2026-09-19-component-host.md
Spec PR: #31 (merged, design-only)
Branch: feat/component-host
Engine: om-auto-create-pr (steps: 2, --loop: no)

## Goal

Add `ComponentHost`, the runtime layer between core and a replaceable component. It asks the
resolver which implementation of a contract renders, renders it with the contract's props inside
its own error boundary and a box sized by the contract's `layout`, and falls back to core's
default, with one notice, when an extension's implementation throws. The registry gains change
notification so a host follows extensions that activate or deactivate.

## Delivery split

The spec decides on one spec, two phases, two stacked PRs (spec Q1). **This run is PR 1: Phase 1**
(spec steps 1–2), proven on the fixture contract `cezar.fixture.task-header@1`. No page uses the
host yet. Phase 2 (the `TaskHeaderMain` contract, the `RunHeader` split, core's default and its
registration, the boundary and gate tests, AGENTS.md and the README) ships as PR 2 on its own
branch, `feat/component-host-task-header`, stacked on this one and tracked by its own plan. Both
are separate PRs by the spec's own decision, not duplicates of each other, as #23/#25 were for the
event API.

## Scope

- `packages/web/src/component-registry/registry.ts`: `subscribe(listener)` and `revision()` on
  `CockpitComponentRegistry`, per § API Contracts. The module stays pure.
- `packages/web/src/component-registry/provider.tsx` (new): `ComponentsProvider`,
  `useComponentRegistry`, `ImplementationFailure`, the failure record and the default reporter
  (one toast and one `[cezar:extensions]` line, spec Q6).
- `packages/web/src/component-registry/component-host.tsx` (new): `ComponentHost` per § Hosting,
  precisely, with the implementation boundary, the fallback boundary, the inline core-failure
  alert with **Try again**, and the `layout` box.
- Tests: `registry.test.ts` (notification), `component-host.test.tsx` (new).

## Non-goals

- Everything in Phase 2 (PR 2): `TaskHeaderMain` in `packages/extension-api`,
  `CORE_COMPONENT_CONTRACTS` stays empty, no `registerCoreComponents`, no `RunHeader` split, no
  `main.tsx`/`app.tsx` wiring, no boundary test, no AGENTS.md or README change.
- No preference store and no picker: `preferenceOf` is a seam that production does not pass yet
  (spec Q5).
- No sandbox, no suspension timeout, no catching of event-handler or async errors (spec § Edge
  Cases).
- No change to `resolve.ts`, the extension registry, the command registry, the event bus, the HTTP
  contract, the service or the api-client.

## Implementation Plan

### Phase 1: The host

1. **Registry change notification** (`registry.ts`), per § API Contracts. A listener is called
   synchronously after a `register`, a `provide` (compatible or not) and a dispose that removed a
   registration; not after a repeated dispose or a dispose whose id was taken again. `revision()`
   grows with each of those. Unsubscribing twice is harmless, and a throwing listener does not stop
   the others. Tests in `registry.test.ts` (spec Implementation Plan step 1).
2. **`ComponentsProvider` and `ComponentHost`** (`provider.tsx`, `component-host.tsx`), per
   § Hosting, precisely. Tests in `component-host.test.tsx` on the fixture contract with core's
   default and two extension implementations, covering every bullet of spec step 2.

## Risks

- React 19 logs every error an error boundary catches through `console.error` (the root's default
  `onCaughtError`). The tests that make an implementation throw silence and assert on
  `console.error` rather than letting it leak into the run output.
- StrictMode double-renders and double-invokes effects. Recording and reporting run only in
  `componentDidCatch`, and the provider ignores a repeat for the same registration and subject, so
  one failure makes one toast.
- `useSyncExternalStore` needs a stable `subscribe`. The registry's `subscribe` and `revision` are
  created once per registry, so their identity is stable.
- The validation gate runs in Docker through the main checkout's untracked `in-docker.sh`, because
  host state breaks some server tests on WSL2.

## Progress

PR: #32

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The host

- [x] 1.1 Registry change notification — 802489da
- [x] 1.2 ComponentsProvider and ComponentHost — ff004d3d
