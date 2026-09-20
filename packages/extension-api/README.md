# `@open-mercato/cezar-extension-api` — the extension contract

> **Experimental and private.** The cockpit's extension registry
> (`packages/web/src/extensions/registry.ts`, spec `2026-09-18-extension-registry`) runs the
> extensions compiled into the cockpit. Of the services behind `ExtensionContext`, `commands`
> (spec `2026-09-19-command-api`), `events` (spec `2026-09-19-extension-event-api`),
> `components` (spec `2026-09-19-component-registry`) including implementation-owned settings
> (spec `2026-09-19-component-settings-api`) and notifications are honoured; storage remains a
> placeholder behind its permission until its host item lands. Each host item may still revise
> these types in the PR that implements it.
> `context.components` records implementations, while rendering and selection arrive with the slot
> and picker items. Component contracts are checkable anywhere — `checkComponentCompatibility`
> runs in your own tests too (spec `2026-09-19-component-contract-api`). The package is versioned
> with the release but not published to npm. Design: `.ai/specs/2026-09-18-extension-api-package.md`.

The one package an extension imports. It holds the vocabulary Cezar and its extensions share —
manifest, lifecycle, commands, events, storage, the component registry and errors — and nothing
else. An extension that reaches past it into `packages/web` or the api-client is programming
against internals that move with every refactor.

## Package Manifest

An installable extension describes itself at the package root with `cezar.extension.json`. The
document is the distribution form of `ExtensionManifest`; it adds the API generation, entrypoint
paths and package metadata without requiring an installer to execute the extension:

```json
{
  "id": "acme.jira",
  "name": "Jira Integration",
  "version": "1.3.0",
  "homepage": "https://acme.example/jira",
  "cezar": { "apiVersion": 1 },
  "engines": { "cezar": "^0.12.0" },
  "entrypoints": { "frontend": "./dist/frontend.js" },
  "permissions": ["ui.components", "commands.execute"]
}
```

`validatePackageManifest(value)` is the format gate. It keeps the existing identity, semver and
permission grammar, requires `cezar.apiVersion` and `entrypoints.frontend`, and validates an
optional backend entrypoint for a future host. At API generation 1, `cezar`, `entrypoints` and
`permissions` are strict; unknown top-level metadata remains forward-compatible. Entrypoints are
package-relative `.js` or `.mjs` paths, and package URLs must be absolute `https:` URLs.

`checkPackageCompatibility(manifest, host)` is the host gate. It first rejects malformed data,
then checks the API generation, the supported `engines.cezar` range and finally each declared
entrypoint kind. Unsupported ranges and release candidates are refused unless the range explicitly
opts into the prerelease. Both functions are pure and do not read the filesystem or execute an
extension.

## Rules

1. **One entry point.** `exports` has exactly `.` (plus `./package.json`), and `src/index.ts` only
   re-exports. A file under `src/` is not public until the barrel exports it; the runtime export
   names are pinned in `test/surface.test.ts`.
2. **Zero runtime dependencies.** A handful of pure helpers and one error class; everything else is
   types. In `src/`, React is referenced through `import type` only (`@types/react` is an optional
   peer), so an extension can bundle its own copy of the package without pulling anything in.
   `examples/` may import `react` as a value, as a real extension that renders does; `react` is a
   devDependency pinned to the cockpit's range, so the cockpit's tests load one React.
3. **Node-free and DOM-free.** `lib: ["ES2022"]` and `types: []` make a `node:*` import or a DOM
   global a compile error, so the same source runs in the cockpit, in vitest's Node environment and
   in a future worker. Tests live in `test/`, never in `src/`.
4. **Never imports the cockpit, the service or their contract** — `@open-mercato/cezar-web`,
   `@open-mercato/cezar`, `@open-mercato/cezar-api-client`, `@open-mercato/cezar-contract`, or a
   `packages/web` path. `test/boundary.test.ts` enforces this for `src/` and `examples/`: `src/`
   imports only its own files and React types, and examples import only this package and `react`.
5. **Raw `.ts` exports**, like `contract` and `api-client`: consumers must be TypeScript-aware
   (Vite, vitest, tsx). Plain `node` cannot import it until publication adds a build.

## Writing an extension

The worked example is `examples/hello-extension/index.ts` — it imports only this package, and
`test/example.test.ts` activates it. The worked examples for a core contract are
`examples/compact-task-header/index.ts`, the minimal one-row task header that takes over the task's
actions, and `examples/jira-task-header/index.ts`, a task header with its own React state and its
own draft feature while taking over those same actions. Both import only this package and `react`.
The shape:

- `defineExtension({ manifest, activate, deactivate? })` validates at module load and throws
  `ExtensionDefinitionError` (code `invalid-manifest`, with every issue) on a broken manifest.
- Everything is registered **imperatively** in `activate(context)` — the manifest is identity and
  compatibility only.
- Commands, events and component contracts are **typed tokens** made with `defineCommand`,
  `defineEvent` and `defineComponentContract`. Producers and consumers share a token and get
  compile-time checking; the host matches tokens **by `id` (and `version`)**, never by object
  identity, because every bundle carries its own copy of the package.

```ts
const extension = defineExtension({
  manifest: {
    id: 'acme.hello',
    name: 'Hello',
    version: '1.0.0',
    engines: { cezar: '^0.11.0' },
    permissions: ['storage', 'events'],
  },
  activate(context) {
    // The host supplies the matching grant before this runs.
    context.events.emit(defineEvent('acme.hello.started'))
  },
})
```

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

### Layout schemas

`LayoutSchema` is the serializable intent for a page: named zones contain ordered placements,
each identified by a stable id and a `contract` plus its major version. V1 allows only typed layout
hints (`collapsed`, `density` and `width`); it never stores a React component, implementation
choice, runtime props, component settings or DOM reference. `parseLayoutSchema` validates an
already-decoded value, `parseLayoutJson` also reports malformed JSON, and
`serializeLayoutSchema` emits deterministic JSON.

The schema is separate from `packages/web/src/lib/layout-elements.ts`: `LayoutSchema` is persisted
layout intent, while `LayoutRegistry` is the runtime projection used by edit mode and drag-and-drop.
Persistence, rendering, resolver selection and migration are separate consumers and are not implied
by this contract.

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

### Permissions

The manifest's `permissions` list is a **request**, not an approval. The installer will pass the
approved list to `register(extension, { grantedPermissions })`; compiled-in extensions receive a
host-policy grant. An omitted list or grant is empty. `context.permissions` is the frozen effective
set for this activation, and there are no run-time permission prompts.

The host checks compatibility before calling `activate`. Every requested name must be supported by
this Cezar and present in the grant. An unknown or planned name fails closed with
`unsupported-permission`; a missing approval fails with `permission-not-granted`. No extension
code runs in either case. A grant that contains names the manifest did not request is ignored.

| Permission | Allows | Status |
| --- | --- | --- |
| `ui.components` | Providing component implementations and UI contributions | supported |
| `commands.execute` | Public Cezar commands and other extensions' commands | supported |
| `storage` | This extension's namespaced storage (and future secrets) | supported |
| `events` | Listening to public events and emitting this extension's events | supported |
| `notifications` | Transient plain-text messages in Cezar's notification UI | supported |
| `network` | Declares intent only; it currently protects nothing | reserved / not enforceable |
| `filesystem`, `shell`, `backend.routes`, `commands.intercept` | Future privileged APIs | planned |

`context.extension`, `context.subscriptions`, `context.permissions`, `commands.register` and an
extension's own `${extension.id}.` commands are always available. A different command requires
`commands.execute`; without it, `commands.has` is `false` and `execute` rejects. All other denied
services remain present and fail with `permission-denied`. The error has `permission` and `api`
fields and is checked portably with `isExtensionError(error, 'permission-denied')`. Liveness wins:
after deactivation a call reports `disposed` instead.

This is an API guarantee, not a sandbox. Extension code still runs in the cockpit's origin and can
use capabilities outside this context, including direct browser APIs. `network` is deliberately
reserved and must never be presented as a security boundary.

### Notifications

`context.notifications.info`, `.warning` and `.error` show a transient plain-text message prefixed
with the extension's display name. Messages must be non-empty strings of at most 500 characters.
The cockpit allows five messages per extension in a sliding ten-second window; additional messages
are dropped and reported by the host without throwing. Notifications are page-local, not stored,
and have no markup or actions.

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
| `TaskStarted` | `cezar.task.started` | `TaskTransition` | Into `running` from anything but `running`/`waiting`: a start, a Continue, a send-back, an auto-resume. A deferred resume (an auto-resume, or one that waits for capacity) re-queues first, so its start comes from `queued`. Answering an agent's question is not a start. |
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

`context.components.provide(contract, { id, title, capabilities?, settings?, component })` offers an
implementation of a core contract. Providing never selects: the user picks an implementation per
contract, core's default always stays available, and a replacement that throws while rendering
falls back to it. Core's default is the same shape as yours, `cezar.…` instead of your prefix, and
goes through the same check. A settings definition is declared with `defineSettings({ scope, schema })`
and supports generated `booleanSetting`, `stringSetting`, `numberSetting` and `selectSetting` fields.
Each field may provide a `label` and `description`; string and number fields carry their own bounds,
and select fields declare their allowed options. The host stores sparse scalar overrides under the
exact implementation id in global or active-project UI state, fills defaults before rendering, and
exposes them only through the implementation-only `useComponentSettings()` reader. The Settings →
Components page generates these controls for configurable implementations, autosaving booleans and
selects immediately and text/numbers on blur or after 400 ms of inactivity. The returned registration
handle can read or observe its own settings, but has no setter or cross-implementation access.

**Status.** The cockpit serves two core contracts: the task header's main part and task metadata
(below). It keeps
every implementation per contract with the id of the extension that provided it, and renders a
contract through its component host. Choosing an implementation arrives with the picker item, so
until then core's default renders everywhere.

**The host.** A slot renders only what the resolver picks, inside its own error boundary and a box
sized by the contract's `layout`. If your implementation throws while rendering, or in an effect or
lifecycle method, the host shows core's default in its place for that subject (e.g. that task), and
the user gets one notice naming your implementation. The rest of the page keeps working. A boundary
is not a sandbox: an error in an event handler or a promise is not caught (React unmounts nothing
for it, so it only reaches the console), and an infinite loop or a component that never stops
suspending cannot be stopped. If your extension deactivates, core's default takes its place without
a notice.

**The task header's main part.** `TaskHeaderMain` (`cezar.task.header.main@1`) is the header's
public model and its presentational part: the title, the status and the basic facts. Its props are
all JSON except seven intents:

- `task` (`taskId`, `projectId`, `title`, `prompt`, `status`, `archived`) and `attention` (the
  status as the task list reads it: `label`, `tone`, `pulse`, `queuePosition?`);
- `engine` (`runner`, `model`, `account?`, `identity?`);
- `meta` (`workflow`, `branch?`, `diff?`, `references?` with each one's forge `status`, `lookup`
  state and `conflicting` flag, `automation?`, `usage?`) and `plan?`;
- `actions`: `continue`, `stop`, `archive`, `resolveConflicts` and `chooseEngine`, each
  `{ available, enabled, pending, reason? }`.

A string the union may grow (`status`, `tone`, a reference's `status` or `lookup`) is read as
absent, or `neutral` for a tone, when you do not know it. A usage metric the server hides is
absent. No query client, mutation, router or command token crosses the boundary: the actions are
**intents** that return nothing, and core decides what each one does.

| Intent | What core does |
| --- | --- |
| `onContinue()` | Runs `cezar.task.continue` for the task (on a connected runner when its own is not). A failure shows the server's words. |
| `onStop()` | Opens core's "Cancel this task?" confirmation. Only **Cancel the run** stops the task. |
| `onArchive()` | Runs `cezar.task.archive`, restoring the task when `task.archived`. |
| `onResolveConflicts(n)` | Asks the task's agent to resolve conflicts in pull request `n`, a `conflicting` reference. |
| `onRename()` | Opens core's title editor over your part, with the user's saved draft. |
| `onNavigate(href)` | Navigates within the cockpit for an `href` core put in these props (`meta.automation.href`). Any other value does nothing. |
| `onChooseEngine()` | Moves focus to core's engine picker for the next continuation. |

Core checks the action's state again on every call, so a call does nothing unless the action is
`available` and `enabled` (a repeat while one is `pending` included): an implementation can never
do more than the user could with core's own buttons. Core keeps everything else around your part
and renders it itself: Finish, Open in, Notes, Mark unread, Pin, Delete, the tabs, the monitoring
and dispatch lines, the step rail, the resume hint and the title editor. `shows-title` and
`shows-status` are required, and the host reserves 30 px (one title row) while an implementation
loads, fails or is swapped. Provide it like
any contract, with an id under your prefix and at least the two required capabilities.

**Taking over an action.** Continue, Cancel and Archive stay in core's action bar unless you take
one over, each on its own, with an optional capability: `offers-continue`, `offers-stop` or
`offers-archive`. Declare one and render that action from `actions`, calling its intent; core then
leaves it out of its bar. While your part offers any of the three, core's **Run actions** menu stays
visible at every width and still lists every task action, so the task stays controllable whatever
your part renders. An action you do not declare, core renders beside your part, and you should not.
Stop keeps core's confirmation: `onStop()` asks the user, and only **Cancel the run** stops the
task. If your part throws, core's default comes back and so do core's buttons.
`examples/compact-task-header/index.ts` declares all three; `test/compact-task-header.test.ts`
checks it as a host does, and the cockpit's `external-task-header.test.tsx` uses it on the task page.
`examples/jira-task-header/index.ts` adds a local-state Jira draft that copies plain text to the
clipboard; it does not contact Jira. Its `test/jira-task-header.test.ts` covers the draft rules and
the same capability check.

An extension component that uses hooks must import `react` but never bundle a second copy. React is
the cockpit's runtime: a duplicate makes every hook fail, after which the host renders core's
default implementation as its fallback. Keep `react` aligned with the cockpit's version range.

**The task composer.** `TaskComposer` (`cezar.task.composer@1`) is the task thread's reply box.
It is a controlled view: core owns the draft, delivery, continuation engine, completion lists and
quick replies, while an implementation receives `TaskComposerProps` and reports the user's actions
through nine `void` intents. Every data prop is JSON; `onAttachFiles` accepts a structural file
(`name`, `type`, `size`, `arrayBuffer()`), so an extension does not import a DOM type.

The model includes `draft`, `status`, `availability`, `actions`, `completions`, attachment
`limits`, and an optional `engine` with runner and model choices. Its intents are
`onTextChange`, `onSubmit`, attachment and engine selection, completion loading and usage, and
navigation. The required capabilities are `edits-draft`, `sends` and `shows-availability`.
`attaches-files` and `chooses-engine` are optional: when an implementation does not declare one,
core renders the corresponding attachment row or engine picker beside it. Core reserves 88 px while
the box loads or swaps.

See `examples/plain-task-composer/` for a minimal implementation that imports only this package
and React; the cockpit test exercises it through the real extension registry.

The contract intentionally does not expose a query client, draft store, router, command token or
React node. A minimal implementation can render `draft.text` and call `onSubmit()` without
knowing how a task is delivered or persisted.

**Task metadata.** `TaskMetadata` (`cezar.task.metadata@1`) is the separate contract for workflow,
branch, references, diff, automation, usage/cost and engine metadata. Its props are `task`,
`metadata`, `actions` and optional callback `intents`; the model is shared with the header, but the
metadata implementation never depends on the header's adapter. `shows-metadata` is required;
`offers-links` and `offers-copy` are optional. Core places this 20 px slot and owns its visibility,
spacing and mobile details toggle. An implementation should wrap or truncate at any width and must
not assume where the slot sits. Core's `CoreTaskMetadata` is the default; a replacement that throws
falls back independently to that row. The task page hosts metadata below the title part even when a
replacement header is selected.

**What `provide` throws, and what it keeps.** Your own mistakes throw: `disposed` after
deactivation, `invalid-id` for a token that is not `{ kind: 'component', id, version }` or a
malformed implementation id, `namespace-violation` for an id outside `${extension.id}.`,
`duplicate-registration` for an id already provided, and `invalid-input` for a field of the wrong
type (an empty `title`, a `component` that is not a function or an object, `capabilities` that is
not an array of strings). An implementation that does not fit is kept but never rendered, and is
reported as a diagnostic in the browser console instead of thrown: another major
(`contract-version-mismatch`), a missing required capability (`missing-capability`), or a contract
this Cezar does not serve (`unknown-contract`). So one outdated component never fails your
activation.

A contract made with `defineComponentContract<Props>(id, options)` has three parts:

- **Props**, the typed half. The implementation must take exactly those props, callbacks included;
  the TSDoc on each prop states what it promises. Data props are JSON view models declared in this
  package, and only callbacks are functions.
- **Capabilities**, the behaviours types cannot prove (`restores-draft`). `requiredCapabilities`
  are the ones every implementation must declare; `optionalCapabilities` are the ones it may
  declare, and the host relies on one only for an implementation that declares it (otherwise it
  hides that feature, for example). An implementation lists what it honours in `capabilities`;
  names the contract does not know are kept as custom capabilities and never affect the fit. An
  extension should prefix custom names with its id (for example `example.hello.preview`) so a
  custom capability stays clear of names core may add later. Names are one or more dot-separated segments of
  `[a-z0-9][a-z0-9-]*`, at most 64 characters, unique, and at most 32 across both lists.
- **Layout**, optional and advisory: the box the host gives every implementation.
  `sizing: 'content' | 'fill'` (`fill` means stretch into the remaining space), `sticky: 'top' |
  'bottom'`, and `minBlockSize`, the pixels (0–2048) the host reserves so the page does not shift.
  The host keeps the breakpoints. Unknown keys are rejected.

`defineComponentContract` validates all of it at module load and throws `invalid-id` with every
issue. Capabilities are **declared, not verified**: the check below compares declarations, and a
behaviour that is wrong without throwing is the implementation author's responsibility.

**Checking an implementation.** `checkComponentCompatibility(contract, implementation, implemented?)`
never throws and never touches React. It returns `{ compatible, issues, capabilities,
missingCapabilities, customCapabilities }`. `issues`
holds whatever stops the check first: every `malformed` field (at most one per capability list,
and a list over 256 names is not read), else one `contract-id-mismatch`, else one
`contract-version-mismatch`, else every `missing-capability` at once. `capabilities` is what the
host may rely on: the required ones plus the optional ones you declare. `missingCapabilities`
lists required names not declared, and `customCapabilities` lists declared names this contract does
not know. The host passes its own
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

`example.hello.greeting` is the example's own contract, which the cockpit does not serve: on a real
host this registration is recorded as `unknown-contract`, and the example is exercised against the
test context only. Its test (`test/example.test.ts`) checks it as a host does:

```ts
const outcome = checkComponentCompatibility(Greeting, loud.implementation, loud.contract)
expect(outcome).toEqual({
  compatible: true,
  issues: [],
  capabilities: ['greets-by-name'],
  missingCapabilities: [],
  customCapabilities: [],
})
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
malformed command, event or component contract token, or a malformed component implementation id); `namespace-violation`, `duplicate-registration`, `command-not-found`,
`contract-version-mismatch`, `storage-quota`, `disposed`, `invalid-input`, `command-failed`,
`command-timeout` and `permission-denied` come from the host. The union grows additively: a copy of this package older than
the host does not recognise the newer codes.
