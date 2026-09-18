# `@open-mercato/cezar-extension-api` — the extension contract

> **Experimental and private.** Nothing loads extensions yet: the cockpit gains a host runtime in a
> later item, and every host item may still revise these types in the PR that implements them.
> The package is versioned with the release but not published to npm.
> Design: `.ai/specs/2026-09-18-extension-api-package.md`.

The one package an extension imports. It holds the vocabulary Cezar and its extensions share —
manifest, lifecycle, commands, events, storage, the component registry and errors — and nothing
else. An extension that reaches past it into `packages/web` or the api-client is programming
against internals that move with every refactor.

## Rules

1. **One entry point.** `exports` has exactly `.` (plus `./package.json`), and `src/index.ts` only
   re-exports. A file under `src/` is not public until the barrel exports it; the runtime export
   names are pinned in `test/surface.test.ts`.
2. **Zero runtime dependencies.** A handful of pure helpers and one error class; everything else is
   types. React is referenced through `import type` only (`@types/react` is an optional peer), so
   an extension can bundle its own copy of the package without pulling anything in.
3. **Node-free and DOM-free.** `lib: ["ES2022"]` and `types: []` make a `node:*` import or a DOM
   global a compile error, so the same source runs in the cockpit, in vitest's Node environment and
   in a future worker. Tests live in `test/`, never in `src/`.
4. **Never imports the cockpit, the service or their contract** — `@open-mercato/cezar-web`,
   `@open-mercato/cezar`, `@open-mercato/cezar-api-client`, `@open-mercato/cezar-contract`, or a
   `packages/web` path. `test/boundary.test.ts` enforces this for `src/` and `examples/`.
5. **Raw `.ts` exports**, like `contract` and `api-client`: consumers must be TypeScript-aware
   (Vite, vitest, tsx). Plain `node` cannot import it until publication adds a build.

## Writing an extension

The worked example is `examples/hello-extension/index.ts` — it imports only this package, and
`test/example.test.ts` activates it. The shape:

- `defineExtension({ manifest, activate, deactivate? })` validates at module load and throws
  `ExtensionDefinitionError` (code `invalid-manifest`, with every issue) on a broken manifest.
- Everything is registered **imperatively** in `activate(context)` — the manifest is identity and
  compatibility only.
- Commands, events and component contracts are **typed tokens** made with `defineCommand`,
  `defineEvent` and `defineComponentContract`. Producers and consumers share a token and get
  compile-time checking; the host matches tokens **by `id` (and `version`)**, never by object
  identity, because every bundle carries its own copy of the package.

### Ids

| Kind | Grammar | Example |
| --- | --- | --- |
| Extension id | `publisher.name` — two segments of `[a-z0-9][a-z0-9-]*`, ≤ 64 chars | `acme.compact-tasks` |
| Contribution id (command, event, contract, implementation) | two or more such segments, ≤ 128 chars | `acme.compact-tasks.open-next` |

Every id an extension creates starts with its own extension id; the host enforces that ownership
at registration. The `cezar` publisher is reserved for core — the grammar accepts it, the host
refuses it from anyone else.

### The JSON boundary

Command arguments and results, event payloads and stored values must be JSON. `IsJson<T>` checks
that at the type level — interfaces, optional fields, arrays and recursive shapes pass; a function,
`Date`, `bigint` or `symbol` anywhere inside makes the call a compile error. Only component props
may carry functions. This keeps a future isolated runtime (worker or iframe) for non-UI logic
possible without an API break. The host still treats every payload as untrusted data.

### Lifecycle

`activate` is awaited once. Everything registered through the context is disposed automatically on
deactivation, in reverse order, after `deactivate()` resolves; every `register`/`on`/`provide` also
returns a `Disposable` for early removal, and `dispose()` is idempotent. Put your own resources
(timers, DOM listeners) in `context.subscriptions`. Any context call after deactivation fails with
code `disposed`.

### Storage

`context.storage` is async, private to the extension and holds JSON values. `get<T>()` is an
unchecked cast — the data may have been written by an older version of your extension, so validate
what you read (the example does). Like all Cezar state it may be deleted; work from empty storage.

### Replacing a component

`context.components.provide(contract, { id, title, component })` offers an implementation of a
core contract. The contract's props **are** the functional contract, callbacks included, and the
implementation must take exactly those props. Providing never selects: the user picks an
implementation per contract, core's default always stays available, and a replacement that throws
while rendering falls back to it. An implementation is bound to the contract `version` it was
compiled against; a host on another major ignores it (`contract-version-mismatch`).

### Errors

`isExtensionError(error, code?)` recognises every `ExtensionErrorCode` by its `code`, never by
`instanceof`, so an error from another copy of the package is still classified. `invalid-manifest`
and `invalid-id` come from this package's helpers; `namespace-violation`,
`duplicate-registration`, `command-not-found`, `contract-version-mismatch`, `storage-quota` and
`disposed` come from the host.
