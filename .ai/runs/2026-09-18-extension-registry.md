# Extension registry — the cockpit's extension lifecycle runtime

Source doc: .ai/specs/2026-09-18-extension-registry.md

## Goal

Give the cockpit a registry that holds extensions by id, runs their `activate()`/`deactivate()`
with isolation, a time limit and the disposal promises of `ExtensionContext`, and reports each
one's status — started at boot with an empty built-in list, so nothing a user sees changes.

## Scope

- `packages/web/src/extensions/` — new: `registry.ts` (pure: imports only the extension-api
  package), `host.ts` (`unavailableServices`, `startExtensionHost`), `builtin-extensions.ts`
  (empty `BUILTIN_EXTENSIONS`), and their vitest tests.
- `packages/web` wiring: the `@open-mercato/cezar-extension-api` workspace dependency, the
  `vite.config.ts` alias and `tsconfig.json` `paths` entry to its source, `package-lock.json`
  (workspace link only), a `vite-config.test.ts` assertion pinning the alias, and one
  un-awaited `startExtensionHost(...)` call in `main.tsx` before rendering.
- Docs only in `packages/extension-api` (README status + lifecycle section; lifecycle TSDoc in
  `src/context.ts` and `src/extension.ts`) and `AGENTS.md` (layout row, task-routing row).

### Non-goals

- The four host services behind `ExtensionContext` (commands, events, storage, components) —
  placeholders only; each is a later item behind the `services(scope)` seam.
- A management UI, runtime `enable`/`disable`, persisted enablement, the loader, the
  `engines.cezar` range check and the reserved `cezar` publisher check (spec Q5, Q6).
- Any change to `packages/cezar`, the contract, the api-client, an HTTP route, the release
  scripts or the extension-api runtime surface (`test/surface.test.ts` stays unchanged).
- A React provider or singleton accessor for the registry instance (no consumer yet).

## Implementation Plan

Every step keeps `npm run typecheck`, `npm test`, `npm run test:unit`, `npm run build` and
`npm run test:package` green. Steps follow the spec's § Implementation Plan one-to-one. Tests are
vitest tests in the `web` project, define fixtures with `defineExtension` imported by package
name, use a recording `services` factory, and test timeouts with fake timers or a small
`timeoutMs`.

### Phase 1: The registry

1. Wire the package into `packages/web` (dependency, alias, `paths`, lockfile) and add
   `registry.ts` with `createExtensionRegistry`, `register`, `get`, `list`, `listActive`,
   `ExtensionRegistryError` and the record types; `vite-config.test.ts` pins the alias;
   `registry.test.ts` covers registration and records.
2. Activation: scope, guarded `subscriptions`, context assembly, `activate`, `activateAll`, the
   timeout, failure cleanup, per-extension serialization and abandoned calls, with the spec's
   Step 2 tests.
3. Deactivation and disposal: awaited `deactivate`, reverse-order disposal (subscriptions, then
   tracked registrations), isolated dispose errors, `disposed` after the scope ends, with the
   spec's Step 3 tests and one test per § State machine row.

### Phase 2: Cockpit boot and docs

4. `builtin-extensions.ts`, `host.ts` (`unavailableServices`, `startExtensionHost`) and the
   `main.tsx` call, with `host.test.ts`.
5. Docs: extension-api README (status line, lifecycle section) and lifecycle TSDoc; `AGENTS.md`
   layout row and extensions task-routing row.

## Risks

- **Serialization and abandoned calls are easy to get subtly wrong.** Each rule of § State
  machine gets its own test, and the fake-timer tests assert call counts on `activate`.
- **Resolving extension-api source from web.** The package is a linked workspace, so an import by
  name resolves even without the alias; `vite-config.test.ts` pins the alias and `npm run
  typecheck` proves the source compiles under web's compiler options (including
  `noUncheckedIndexedAccess`, which extension-api also sets).
- **Release friction.** `packages/web` now depends on `packages/extension-api`, which is outside
  `ReleaseManifests`; the release PR must bump both by hand (spec § Risks). Not changed here.
- **Default path.** `main.tsx` gains one call; with an empty list it resolves an empty
  `activateAll`, never throws and is never awaited. `host.test.ts` pins "never throws, `ready`
  never rejects".

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The registry

- [x] 1.1 Wire the package, then registration and records — a5b4224a
- [x] 1.2 Activation — f2fe6088
- [x] 1.3 Deactivation and disposal — 2f6bcaf3

### Phase 2: Cockpit boot and docs

- [x] 2.1 Host and boot — 9664a6da
- [x] 2.2 Docs — e7c67f60
- [x] Post-review fix: clamp the registry timeout to setTimeout's ceiling (Infinity no longer times out at once) — a95aad45
