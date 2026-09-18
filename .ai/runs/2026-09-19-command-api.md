# Command API — typed business actions behind one registry

Source doc: .ai/specs/2026-09-19-command-api.md
Spec PR: #10 (merged)

## Goal

Give the cockpit one command registry (`register` / `execute` / `has`) that core and extensions
share: three public `cezar.task.*` commands whose handlers own the HTTP call and the cache
rules, `context.commands` honoured for extensions, every failure a coded error — and move the
run header's Continue, Cancel and Archive onto it with no visible change.

## Scope

- `packages/extension-api` — `Commands.has`, three error codes (`invalid-input`,
  `command-failed`, `command-timeout`), `src/core-commands.ts` (the three task tokens and their
  input/result types, exported from the barrel), the `test/fake-context.ts` `has`, the surface
  snapshot, the README.
- `packages/web/src/commands/` — new: `registry.ts` (pure: only the extension API at runtime),
  `core-commands.ts` (`registerCoreCommands`, `invalidateTaskKeys`), `provider.tsx`
  (`CommandsProvider`, `useCommands`, `useCommand`) and their tests.
- `packages/web` wiring: `cancelProjectRun` in `api/client.ts`; `cockpitServices` and the
  `has` placeholder in `extensions/host.ts`; the boot order in `main.tsx`; optional
  `queryClient` / `commands` props and the provider in `app.tsx`; the run header's
  `useRunActions` on `useCommand`.
- `AGENTS.md` task-routing row for `packages/web/src/commands/`.

### Non-goals

- The other copies of these actions (`follow-up-engine.tsx`, `review-panel.tsx`,
  `useContinueRun`, `useArchiveIndexedRun`) — the spec's UI-migration follow-ups.
- Events, storage, components, the command palette, key bindings, enablement, a loader or any
  `BUILTIN_EXTENSIONS` entry.
- Any change to `packages/cezar`, the contract, the api-client, an HTTP route or a state file.

## Implementation Plan

Every step keeps `npm run typecheck`, `npm test`, `npm run test:unit`, `npm run build` and
`npm run test:package` green. Steps follow the spec's § Implementation Plan one-to-one. Registry
tests are vitest tests in the `web` project with tokens from `defineCommand` imported by package
name, a recording `ExtensionScope` fake, and a small `timeoutMs` or fake timers for timeouts.

### Phase 1: The registry

1. Extension API: `Commands.has`, the three codes in `ExtensionErrorCode` and `ERROR_CODES`,
   TSDoc, `has` on `test/fake-context.ts`, `has: fails('commands')` on `unavailableServices`;
   `errors.test.ts` and a `has` type test.
2. Core registration and execution: `createCommandRegistry`, `register`, `execute`, `has`,
   `CommandError`, per § Execution, precisely; `commands/registry.test.ts`.
3. The extension view: `forExtension(scope)` — namespace, `scope.track()`, visibility,
   `disposed`, `command-timeout`; tests.

### Phase 2: Core commands and the extension service

4. Tokens and handlers: `src/core-commands.ts` in the extension API (surface snapshot gains
   `TaskArchive`, `TaskContinue`, `TaskStop`), `cancelProjectRun`, `commands/core-commands.ts`
   with `registerCoreCommands` and `invalidateTaskKeys`; `core-commands.test.ts`.
5. Boot wiring and the extension service: `cockpitServices({ commands })`, the `main.tsx` boot
   order, `App` accepting optional `queryClient` / `commands`; `host.test.ts` fixture extension
   executes `TaskArchive`.

### Phase 3: React bindings, the first component, docs

6. Provider and hooks: `CommandsProvider`, `useCommands`, `useCommand`; `App` mounts the
   provider inside `QueryClientProvider`; tests.
7. Migrate the run header: `useRunActions` runs `TaskContinue`, `TaskStop`, `TaskArchive`
   through `useCommand`; the existing `run-header.test.tsx` cases pass with only
   `CommandsProvider` added; a source check that the three client functions are not imported.
8. Docs: `packages/extension-api/README.md` (`has`, codes, the controlled-error rule,
   visibility, the core task commands) and the `AGENTS.md` task-routing row.

## Risks

- **Changing a mechanism that works (the run header).** Pending state, the danger toast with the
  server's words, the 409 refetch, `canContinue` sending nothing, the archive toggle and the
  cancel dialog must all survive. The existing fetch-level tests are the proof and must pass
  with only the provider added to their harness.
- **Errors are wrapped.** A migrated action sees `CommandError`, not `ApiError`; its `message`
  is the server's own words, so the toast is unchanged. Terminal / delete keep `ApiError`.
- **Contract growth.** `Commands.has` is breaking only for implementers of `Commands` — the
  cockpit and the package's test fake — and both change here.
- **Timeout semantics.** Only extension-provided handlers race `timeoutMs`; a core handler is
  never cut off. Tested both ways.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The registry

- [x] 1.1 Extension API: `has` and the codes — f0f931e0
- [x] 1.2 Core registration and execution — b7ae03fa
- [x] 1.3 The extension view — 45ea37d5

### Phase 2: Core commands and the extension service

- [x] 2.1 Tokens and handlers — 79141138
- [x] 2.2 Boot wiring and the extension service — 8e312f8b

### Phase 3: React bindings, the first component, docs

- [ ] 3.1 Provider and hooks
- [ ] 3.2 Migrate the run header
- [ ] 3.3 Docs
