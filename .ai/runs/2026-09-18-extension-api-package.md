# Extension API package — `@open-mercato/cezar-extension-api`

Source doc: .ai/specs/2026-09-18-extension-api-package.md

## Goal

Add the fifth npm workspace, `packages/extension-api` (`@open-mercato/cezar-extension-api`): a
private, dependency-free, Node-free, DOM-free package that is the only supported contract between
Cezar and an extension — manifest, lifecycle, commands, events, storage, component registry and
errors — proven by an example extension activated in its tests. No shipped behaviour changes.

## Scope

- `packages/extension-api/` — new: `package.json`, `tsconfig.json`, `tsconfig.test.json`,
  `vitest.config.ts`, `src/` (the public surface behind one barrel), `test/` (unit, type and
  boundary tests plus a test-only fake context), `examples/hello-extension/index.ts`, `README.md`.
- Root wiring: `package.json` (`workspaces`, `typecheck:extension-api`), `vitest.config.ts`
  (`projects`), `package-lock.json` (workspace link only).
- `AGENTS.md`: "Repository layout" becomes five workspaces; a "Task routing" row for the package.

### Non-goals

- The host runtime (`ExtensionContext` implementation), extension discovery/loading/trust, core
  component contracts, the implementation picker and command-palette integration — later Epic 1
  items with their own specs.
- Any change to `packages/web`, `packages/cezar`, their Vite aliases or bundles.
- Publication: no `dist` build, no `ReleaseManifests` / release-script change, no
  `BACKWARD_COMPATIBILITY.md` section (spec Q3).
- Extension-declared contracts (`declare`/`resolve`, spec Q7) and core catalogs (spec Q6).

## Implementation Plan

Every step keeps `npm run typecheck`, `npm test`, `npm run test:unit`, `npm run build` and
`npm run test:package` green. Steps follow the spec's § Implementation Plan one-to-one.

### Phase 1: Workspace and boundary

1. Scaffold the package per the spec's § Package and build contract, with `src/index.ts` exporting
   only `Disposable`; wire root `workspaces`, `typecheck:extension-api` and the vitest project;
   `npm install` for the lockfile; `test/surface.test.ts` imports the package by name.
2. `test/boundary.test.ts`: exact `exports` keys, no `dependencies`, `src/` imports relative or
   `import type` from `react`, `examples/` imports relative or the package name, no forbidden
   workspace specifier or `packages/web` path. Check once locally that a forbidden import fails it.

### Phase 2: The API surface

3. Identifiers, manifest, extension: `isValidExtensionId`, `isValidContributionId`,
   `ExtensionManifest`, `validateManifest`, `Extension`, `defineExtension`,
   `ExtensionDefinitionError`, with unit tests for every rule.
4. JSON boundary and errors: `JsonValue`, `IsJson`, `ExtensionErrorCode`, `isExtensionError`, with
   type tests (`@ts-expect-error`) and a duck-typed error test.
5. Commands and events: tokens, `defineCommand`, `defineEvent`, `Commands`, `Events`,
   `CommandOptions`, with runtime and type tests (frozen tokens, no phantom key, payload-less
   `emit`, token distinctness, structural literal assignability).
6. Storage, components, context: `ExtensionStorage`, `ComponentContract`,
   `defineComponentContract`, `ComponentProps`, `ComponentImplementation`, `ComponentRegistry`,
   `ExtensionContext`, with version validation and props-mismatch type tests.

### Phase 3: Proof and documentation

7. `examples/hello-extension/index.ts` exactly as specified, `test/fake-context.ts` (recording
   only, no host semantics) and `test/example.test.ts` activating it.
8. Snapshot the sorted runtime export names in `test/surface.test.ts`.
9. `packages/extension-api/README.md` and the `AGENTS.md` layout and routing updates.

## Risks

- **TypeScript 7 (`tsgo`) and the `IsJson` construction.** The spec states it was checked against
  7.0.2; the Step 4/5 type tests pin it inside `npm run typecheck`, so drift fails the gate.
- **Vitest resolving a raw-`.ts` package by name.** `surface.test.ts` imports through the workspace
  symlink and the `exports` map, which is the point of the test; api-client already works this way.
- **Lockfile churn.** `npm install` must only add the workspace link and its entry; any registry
  change is reverted rather than committed.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Workspace and boundary

- [ ] 1.1 Scaffold the package and wire it into the monorepo gates
- [ ] 1.2 Boundary guard test

### Phase 2: The API surface

- [ ] 2.1 Identifiers, manifest, extension
- [ ] 2.2 JSON boundary and errors
- [ ] 2.3 Commands and events
- [ ] 2.4 Storage, components, context

### Phase 3: Proof and documentation

- [ ] 3.1 The example and a recording fake context
- [ ] 3.2 Export snapshot
- [ ] 3.3 README and AGENTS.md
