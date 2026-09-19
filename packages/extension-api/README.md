# `@open-mercato/cezar-extension-api` — the extension contract

> **Experimental and private.** The cockpit's extension registry
> (`packages/web/src/extensions/registry.ts`, spec `2026-09-18-extension-registry`) runs the
> extensions compiled into the cockpit. Of the services behind `ExtensionContext`, `commands`
> (spec `2026-09-19-command-api`) and `events` (spec `2026-09-19-extension-event-api`) are
> honoured; storage and components arrive in later items, and every host item may still revise
> these types in the PR that implements them. Component
> contracts are already checkable — `checkComponentCompatibility` runs anywhere, in your own tests
> too (spec `2026-09-19-component-contract-api`) — while `context.components` is still
> unimplemented. The package is versioned with the release but not published to npm.
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
| `TaskContinue` | `cezar.task.continue` | `{ taskId, projectId?, runner?, model?, agentProfile?, text?, attachments? }` | `{ taskId, continued: true }` |
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

`TaskContinue` is the continue the follow-up composer runs. Every field but the task is optional
and an omitted one keeps what the task has: `runner` and `model` (`''` is "auto") pick the engine,
`agentProfile` the login (a different one starts a fresh session), `text` the prompt the session
reopens on, and `attachments` up to four `TaskAttachment` files. Switching the runner or the model
is a continue with that argument, not a command of its own: the service applies both only when it
reopens a session. A value the service refuses — a model while models are locked, an unknown
account — rejects `command-failed` with its words.

Continuing a task starts an agent session. That is no new power — extension code runs in the
cockpit's origin — but it is the reason the loader must decide who may run third-party code before
any exists.

### Events

`context.events` is the cockpit's event bus, seen from your extension. Events are typed tokens made
with `defineEvent<Payload>(id)`; the payload is JSON, and a payload-less event is emitted as
`emit(token)`.

- `on(token, listener)` — calls `listener` for every later emit of the event. Returns a
  `Disposable` that removes this one subscription.
- `once(token, listener)` — the same, for the first later emit only.
- `off(token, listener)` — removes every subscription of that exact function to that event made
  through your context, `on` and `once` alike. A re-created arrow function is another listener, so
  keep the reference or keep the `Disposable`. `off` with nothing to remove does nothing.
- `emit(token, payload?)` — only ids under your own `${extension.id}.` prefix. You may listen to
  any id, including one nobody emits yet: that subscription just stays silent, so an extension
  written for a newer Cezar still runs on an older one.

**Delivery.** `emit` returns before any listener runs. Events are delivered in emit order and,
within one emit, in subscription order; a listener receives only events emitted after it
subscribed. The payload is copied as JSON when it is emitted and every listener gets its own copy,
so a mutation by the emitter or another listener is never seen. A payload that is not JSON (a cycle,
a `bigint`) makes `emit` throw `invalid-input`, and nothing is delivered.

**Isolation.** A listener that throws, or returns a promise that rejects, is reported
(`[cezar:extensions] <extension>: listener for <event> failed`) and affects nothing else: the
emitter, the other listeners and your extension's status are untouched.

**Ownership.** An extension emits only into its own namespace, and never a core `cezar.*` event —
even a built-in whose own id is under `cezar`. Anything else throws `namespace-violation`. Names
cannot collide, because every id sits under exactly one owner's prefix. Any extension may listen to
any event, so **never put a secret in a payload**.

**Storms.** An emit made synchronously from inside a listener counts toward a cascade depth; past
16, it is dropped and reported. After 1,000 listener calls without a break the bus yields to the
page and resumes in its next task, so a busy extension cannot freeze rendering.

**Cleanup.** Every subscription is disposed when your extension deactivates — including deliveries
already queued for it — and when a failed or timed-out `activate` ends. While `deactivate()` runs,
your listeners may still be called. Afterwards `on`, `once`, `off` and `emit` throw `disposed`.

**Core events.** Emitted by Cezar only and exported from this package with their payload types:

| Token | Id | Payload | When |
| --- | --- | --- | --- |
| `TaskStatusChanged` | `cezar.task.status-changed` | `TaskTransition` | Every status change of any task, in any registered project. Always first for its change. |
| `TaskStarted` | `cezar.task.started` | `TaskTransition` | Into `running` from anything but `running`/`waiting`: a start, a Continue, a send-back, an auto-resume. Answering an agent's question is not a start. |
| `TaskCompleted` | `cezar.task.completed` | `TaskTransition` | Into `done` or `review` from outside that pair: a successful finish. Accepting a review (`review → done`) is not a second one. |
| `TaskFailed` | `cezar.task.failed` | `TaskTransition` | Into `failed`, a usage-limit parking included. |
| `TaskCancelled` | `cezar.task.cancelled` | `TaskTransition` | Into `cancelled`. |
| `TaskArchived` | `cezar.task.archived` | `TaskEvent` | Archived, from anywhere; last for its change. Restoring emits nothing. |
| `ProjectChanged` | `cezar.project.changed` | `ProjectChange` | The registered project the cockpit shows changed. `null` on a page that belongs to no project. Starts from `null`; no replay and no getter. |
| `ExtensionActivated` | `cezar.extension.activated` | `{ extensionId, version }` | An extension became active — after its own listeners are live, so it hears its own activation. Not replayed for extensions that activate later. |

A `TaskEvent` is `{ taskId, projectId, status }` — ids and statuses only, never a prompt or a
title — and a `TaskTransition` adds `previousStatus`. Both work as a task command's input:

```ts
import { TaskArchive, TaskCompleted } from '@open-mercato/cezar-extension-api'

// Auto-archive every task that finishes successfully. Archiving twice is harmless (see below).
context.events.on(TaskCompleted, (task) => {
  void context.commands.execute(TaskArchive, task)
})
```

Two things to design for:

- **Each open cockpit reacts.** Every page (a second tab, a phone) receives the same task events
  and runs its own extensions, so a reaction runs once per open cockpit. **Never trigger a
  non-idempotent action from a task event** — `TaskContinue` would start one session per page.
- **A disconnect gap is not replayed.** Transitions that happen while the page's connection to the
  server is down are lost; everything after the reconnect is exact. A task event is a nudge, not a
  ledger: when completeness matters, read the current state instead.

### Storage

`context.storage` is async, private to the extension and holds JSON values. `get<T>()` is an
unchecked cast — the data may have been written by an older version of your extension, so validate
what you read (the example does). Like all Cezar state it may be deleted; work from empty storage.

### Replacing a component

`context.components.provide(contract, { id, title, capabilities?, component })` offers an
implementation of a core contract. Providing never selects: the user picks an implementation per
contract, core's default always stays available, and a replacement that throws while rendering
falls back to it. Core's default is the same shape as yours, `cezar.…` instead of your prefix, and
goes through the same check.

A contract made with `defineComponentContract<Props>(id, options)` has three parts:

- **Props**, the typed half. The implementation must take exactly those props, callbacks included;
  the TSDoc on each prop states what it promises. Data props are JSON view models declared in this
  package, and only callbacks are functions.
- **Capabilities**, the behaviours types cannot prove (`restores-draft`). `requiredCapabilities`
  are the ones every implementation must declare; `optionalCapabilities` are the ones it may
  declare, and the host relies on one only for an implementation that declares it (otherwise it
  hides that feature, for example). An implementation lists what it honours in `capabilities`;
  names the contract does not know are ignored. Names are one or more dot-separated segments of
  `[a-z0-9][a-z0-9-]*`, at most 64 characters, unique, and at most 32 across both lists.
- **Layout**, optional and advisory: the box the host gives every implementation.
  `sizing: 'content' | 'fill'` (`fill` means stretch into the remaining space), `sticky: 'top' |
  'bottom'`, and `minBlockSize`, the pixels (0–2048) the host reserves so the page does not shift.
  The host keeps the breakpoints. Unknown keys are rejected.

`defineComponentContract` validates all of it at module load and throws `invalid-id` with every
issue. Capabilities are **declared, not verified**: the check below compares declarations, and a
behaviour that is wrong without throwing is the implementation author's responsibility.

**Checking an implementation.** `checkComponentCompatibility(contract, implementation, implemented?)`
never throws and never touches React. It returns `{ compatible, issues, capabilities }`. `issues`
holds whatever stops the check first: every `malformed` field (at most one per capability list,
and a list over 256 names is not read), else one `contract-id-mismatch`, else one
`contract-version-mismatch`, else every `missing-capability` at once. `capabilities` is what the
host may rely on: the required ones plus the optional ones you declare. The host passes its own
token, your implementation and the token `provide` received; in your tests the third argument
defaults to the contract. From the example extension (`examples/hello-extension/index.ts`):

```ts
const Greeting = defineComponentContract<{ name: string }>('example.hello.greeting', {
  version: 1,
  requiredCapabilities: ['greets-by-name'],
})
// …in activate(context):
context.components.provide(Greeting, {
  id: 'example.hello.loud', title: 'Loud greeting', capabilities: ['greets-by-name'], component: LoudGreeting,
})
```

and its test (`test/example.test.ts`), which checks it as a host does:

```ts
const outcome = checkComponentCompatibility(Greeting, loud.implementation, loud.contract)
expect(outcome).toEqual({ compatible: true, issues: [], capabilities: ['greets-by-name'] })
```

A contract is named `id@version` (`example.hello.greeting@1`) in docs, messages and issues.

#### When `version` changes

A contract's major version is part of the public API. An implementation is bound to the major of
the token it was compiled against, and a host serves one major per contract: on another major it
ignores the implementation (`contract-version-mismatch`) rather than render it with the wrong
props. There are no version ranges. Until the package is published the release notes are the only
notice; at publication each core contract is listed with its major in `BACKWARD_COMPATIBILITY.md`.

| Change to a contract | Bump the major? |
| --- | --- |
| Remove, rename or narrow a prop; make an optional prop required; add a required prop | **Yes** |
| Change when a callback is called, or what it promises | **Yes** |
| Add a required capability, or promote an optional one to required | **Yes**: existing implementations may not declare it |
| Change `layout.sizing` | **Yes**: an implementation built for its own size must now stretch, or the reverse |
| Add an optional prop; add or remove an optional capability; demote a required capability to optional; change `sticky` or `minBlockSize`; clarify TSDoc | No |

### Errors

`isExtensionError(error, code?)` recognises every `ExtensionErrorCode` by its `code`, never by
`instanceof`, so an error from another copy of the package is still classified. `invalid-manifest`
and `invalid-id` come from this package's helpers (the host raises `invalid-id` too, for a
malformed command or event token); `namespace-violation`, `duplicate-registration`, `command-not-found`,
`contract-version-mismatch`, `storage-quota`, `disposed`, `invalid-input`, `command-failed` and
`command-timeout` come from the host. The union grows additively: a copy of this package older than
the host does not recognise the newer codes.
