# `@open-mercato/cezar-extension-api` — the extension contract

> **Experimental and private.** The cockpit's extension registry
> (`packages/web/src/extensions/registry.ts`, spec `2026-09-18-extension-registry`) runs the
> extensions compiled into the cockpit. Of the services behind `ExtensionContext`, `commands` is
> honoured (spec `2026-09-19-command-api`); events, storage and components arrive in later items,
> and every host item may still revise these types in the PR that implements them. The package is
> versioned with the release but not published to npm.
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

`activate` is awaited once per activation. Everything registered through the context is disposed
automatically on deactivation, after `deactivate()` settles: your `context.subscriptions` first,
then the context registrations, each newest first. Every `register`/`on`/`provide` also returns a
`Disposable` for early removal, and `dispose()` is idempotent. Put your own resources (timers, DOM
listeners) in `context.subscriptions`. Any context call after deactivation fails with code
`disposed`.

How the host runs it:

- **Sequential, in order.** Extensions activate one after another, in the order the host lists
  them. One that throws, rejects or hangs fails on its own; the others still activate.
- **Time-limited.** Each `activate()` and `deactivate()` call has a time limit (10 s in the
  cockpit). An `activate` over it fails the extension, and whatever it registered is disposed. A
  `deactivate` over it is reported, and disposal goes ahead.
- **A new context per activation.** Nothing carries over from a previous activation, so keep no
  reference to an old context.
- **Page unload does not call `deactivate`.** Closing or reloading the page discards everything
  without deactivating it, so never rely on `deactivate` to save data: write it as you go.

### Commands

`context.commands` is the cockpit's command registry, seen from your extension:

- `register(token, handler, options?)` — only ids under your own `${extension.id}.` prefix
  (`namespace-violation` otherwise); one handler per id (`duplicate-registration`, and the first
  registration wins). `options.title` is recorded for a future command palette. The registration is
  disposed when you deactivate. **Validate your own input**: types do not exist at runtime, and any
  extension may call your command.
- `execute(token, ...args)` — runs a command and resolves with its result. You can run every other
  extension's commands and core's **public** commands.
- `has(token | id)` — `true` when `execute` would reach a handler you may run right now. A snapshot:
  the provider may go away before your next call. `false` for a malformed token.

**Visibility.** Core picks `public` or `internal` for each of its commands. An internal command
does not exist as far as an extension is concerned: `has` answers `false` and `execute` rejects
`command-not-found`, exactly as for an id nobody registered. Commands registered by extensions are
visible to every extension.

**The controlled-error rule.** `execute` never throws synchronously and only ever rejects with a
coded error that `isExtensionError` recognises:

| Code | When |
| --- | --- |
| `invalid-id` | The token is not `{ kind: 'command', id }` with a valid id (`register` throws it too). |
| `command-not-found` | Nobody registered the id, or you may not run it (an internal core command). |
| `invalid-input` | A core command's validator refused the arguments; nothing was sent. |
| `command-failed` | The handler threw or rejected. `message` is its message, `cause` the original. A handler's own coded error is wrapped too, so the code always describes the call you made. |
| `command-timeout` | An extension-provided handler did not settle within the host's limit (30 s in the cockpit); its late result is ignored. Core handlers are not time-limited. |
| `disposed` | You called after your extension was deactivated (`has` and `register` throw it). |

A handler that throws rejects its caller and nothing else: the providing extension stays active.

**Core task commands.** Exported from this package with their input and result types, so you
execute them with compile-time checking. Each takes one input object; unknown keys are ignored.
`projectId` omitted means the project the cockpit is showing.

| Token | Id | Input | Result |
| --- | --- | --- | --- |
| `TaskContinue` | `cezar.task.continue` | `{ taskId, projectId?, runner? }` | `{ taskId, continued: true }` |
| `TaskStop` | `cezar.task.stop` | `{ taskId, projectId? }` | `{ taskId, stopped }` |
| `TaskArchive` | `cezar.task.archive` | `{ taskId, projectId?, archived? }` (default `true`) | `{ taskId, archived }` |

```ts
import { isExtensionError, TaskArchive } from '@open-mercato/cezar-extension-api'

try {
  await context.commands.execute(TaskArchive, { taskId, projectId })
} catch (error) {
  if (isExtensionError(error, 'command-failed')) console.warn(error.message) // the service's own words
}
```

Continuing a task starts an agent session. That is no new power — extension code runs in the
cockpit's origin — but it is the reason the loader must decide who may run third-party code before
any exists.

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
and `invalid-id` come from this package's helpers (the host raises `invalid-id` too, for a
malformed command token); `namespace-violation`, `duplicate-registration`, `command-not-found`,
`contract-version-mismatch`, `storage-quota`, `disposed`, `invalid-input`, `command-failed` and
`command-timeout` come from the host. The union grows additively: a copy of this package older than
the host does not recognise the newer codes.
