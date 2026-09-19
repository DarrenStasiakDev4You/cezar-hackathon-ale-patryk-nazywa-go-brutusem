# Custom Task Header Extension — a header part with its own state and logic, on core's Continue and Stop

> Slug: `custom-task-header-extension` · Status: **designed, awaiting implementation** · Epic 2
> (Component Platform), item 13: "Create example custom Task Header extension". Builds on
> `2026-09-19-task-header-contract.md` (item 11: `cezar.task.header.main@1`, the intents, the
> `offers-*` capabilities, the compact example), `2026-09-19-component-host.md`,
> `2026-09-19-component-resolver.md` and `2026-09-19-extension-registry.md`. **Starts from `main`
> once #38's changes are on it** (Q2). #37 is on `main` (`d298b017`). #38 (the `offers-*`
> capabilities, `useHostedComponent`, the examples' `react` rule and `examples/compact-task-header/`)
> was merged into its parent branch after that branch had been squash-merged, so none of it is on
> `main`. Re-landing #38 is a prerequisite and not part of this item. Delivery: one PR to `main`,
> touching `packages/extension-api` (a new example and its tests, README) and `packages/web` (one
> test file). No runtime change to the cockpit.

## 📝 TLDR

Item 11 showed that an extension can replace the task header's main part: the compact example
restyles the row and takes over Continue, Stop and Archive. It has no state and no behaviour of its
own. Every click calls one of core's intents. So nothing shows yet that an override can **add**
something core does not have while it keeps core's actions working.

The proposal adds a third worked example, `packages/extension-api/examples/jira-task-header/`,
written against `@open-mercato/cezar-extension-api` and `react` alone. It implements
`cezar.task.header.main@1` (the brief's `task.header@1`) and takes over **Continue** and **Stop**
(`offers-continue`, `offers-stop`). Core's `cezar.task.continue` and `cezar.task.stop` still do the
work, through the contract's intents and core's confirmation. Archive stays in core's bar. The
example's own **Draft Jira issue** button opens a composer held in the example's own React state.
The composer drafts a Jira summary and description from the header's model, lets the user edit
both, and copies either field to the clipboard. It makes no network call, needs no credentials and
no setting, and persists nothing. The example shows no meta row (it does not declare `shows-meta`),
and the spec lists where each meta control stays reachable. A cockpit test activates the example
through the real extension host and uses it on the task page. The test proves each point of the
brief's Definition of Done there.

## Resolved assumptions (autonomous defaults)

The brief left these open. Each answer is the most reversible choice that meets the brief's
Definition of Done. Q3 applies owner decisions from items 10 to 12. The rest are autonomous defaults,
each reversible before implementation starts.

| # | Question | Answer | Why | Status |
|---|---|---|---|---|
| Q1 | The brief bundles an example extension, its custom feature and the proof on the task page. Split into several specs? | **One spec, one PR.** | They do not stand apart. The example is the proof, its custom feature is what the brief asks the proof to show, and a test without the example proves nothing. Re-landing #38 is separate recovery work (Q2), not a second capability of this item. | default, reversible |
| Q2 | #38 (item 11's phase 2) was merged into `feat/task-header-contract` after #37 had been squash-merged into `main`, so `offers-continue`, `offers-stop`, `useHostedComponent`, the examples' `react` rule and the compact example are on no branch that reaches `main`. Build on #38, or stand alone? | **Build on it. #38's changes are re-landed on `main` first, as their own PR, and this item starts after that.** This item does not re-land them. **If the owner drops #38 instead, this spec is revised before anyone implements it.** It does not grow a fallback: bringing the `offers-*` capabilities, the shell code that honours them, `useHostedComponent` and the `react` devDependency here would turn a test-and-example item into a runtime change to the contract, the host and the shell. | The example's point is a header that owns Continue and Stop. Without `offers-*` in the token, its declarations are unknown names the registry ignores, so core's bar would show Continue and Cancel a second time. Hooks need `react` as a value import, which only #38's boundary rule allows in examples. The specs for items 12 and 16, written the same day, also leave re-landing #38 to its own PR. Copying an 800-line reviewed PR into an example PR would hide a lost merge inside an unrelated change. | default, reversible. **Needs the owner's action on #38 before implementation** |
| Q3 | The brief names `task.header@1`. Which contract? | **`cezar.task.header.main@1`**, the part core's shell hosts. The brief's name is illustrative, mapped as items 11 (Q2) and 12 (Q1) mapped it. "Replace core's header" means replacing that part. The shell (tabs, Finish, Open in, Notes, Mark unread, Pin, Delete, the Run actions menu) stays core's. | Owner decision in item 10 (component-host Q4b): only the presentational part is replaceable, so no replacement can take a task's controls away. Item 11 (Q3, owner) then let a part take over Continue, Stop and Archive one by one. | follows owner decisions |
| Q4 | "Still use core's `task.continue` command": does the example execute `cezar.task.continue` itself through `context.commands`, or call the `onContinue()` intent? | **The intent.** The example declares `offers-continue` and calls `onContinue()`. Core executes `cezar.task.continue` with `{ taskId }`, plus `runner` when the task's own runner is not connected, and shows the server's words on failure. The same goes for Stop: `onStop()` opens core's confirmation, and only **Cancel the run** executes `cezar.task.stop`. The example never holds a command token. | Item 11 (Q4) routed header actions through intents so that no header can skip Stop's confirmation or Continue's provider check. An example that executed `TaskContinue` itself would teach the path that decision closed. The cockpit test spies on the command registry, so "core's command ran" is asserted, not assumed. | default, reversible |
| Q5 | Which of core's actions does the example take over? | **Continue and Stop** (`offers-continue`, `offers-stop`), the two the brief lists. **Archive stays in core's bar.** | The brief's row is "Continue · Stop · Create Jira Issue". Leaving one action to core also proves the per-action takeover the owner chose (item 11, Q3) on the real page with a real extension. #38 proved it only with fixture implementations: all three through the compact example, and `offers-continue` alone through a fixture. | default, reversible |
| Q6 | Does **Create Jira Issue** create an issue in Jira? | **No. It drafts one.** The button reads **Draft Jira issue** and opens a composer. There the example builds a summary and a plain-text description from the header's props, the user can edit both, and **Copy summary** and **Copy description** put them on the clipboard for Jira's own Create dialog. No request leaves the page, and nothing needs configuring. | A real issue needs a Jira site, a project and a credential. Extensions have nowhere to keep them: `context.storage` is still a placeholder that rejects (`extensions/host.ts`, `unavailableServices`), and there is no secret store or permission model yet (#40 is an open spec). A browser call to Jira's REST API would need a token in the page and a CORS exception. Jira's prefilled create URL needs numeric project and issue-type ids, which is configuration. Each of these breaks "zero config" (AGENTS.md) for an example. The label does not promise a ticket the example does not create. A real integration is its own item, once storage and permissions exist. | default, reversible |
| Q7 | Where does the example's own state live? | **In React state inside its component** (`useState`, `useRef`, `useEffect`), keyed by `task.taskId`. The state holds whether the composer is open, the two edited fields and the copy feedback. Nothing is persisted. | The brief asks for "its own React state". `context.storage` does not work yet (Q6). The host does not remount a healthy implementation when the user moves to another task (`component-host.tsx`, `resetKey`), so keying by task is what keeps task A's draft off task B's header. | default, reversible |
| Q8 | How does the composer render, given the example may import only the package and `react`? | **As a panel inside the example's own box**, absolutely positioned under the row and never wider than the row, with inline styles. While it is open it covers what lies under it, core's tabs and action bar included, so it closes on **Close**, Escape, its button, and a press anywhere outside it. It is not a portal (`react-dom` is outside the examples' boundary), not core's UI kit (a private import) and not a native `<dialog>` (jsdom 29 has no `showModal`). Colours come from CSS system colours (`Canvas`, `CanvasText`, `ButtonFace`, `GrayText`), which follow the cockpit's `color-scheme` in light and dark. | An absolutely positioned panel does not change the header's height. That height matters because the Changes and Files tabs pin their panes under it (item 11 § Edge Cases). The shell is `relative z-20`, and nothing between it and the host's box clips, so the panel overlays what is below. Bounding it by the row keeps it on screen at 375 px, where core's ⋮ menu sits to the right of the row. Tailwind classes would not exist for a file outside the cockpit's sources, and the cockpit's `--*` tokens are undocumented internals. | default, reversible |
| Q9 | Must the example be reachable in the shipped cockpit? | **No.** It is not added to `BUILTIN_EXTENSIONS`. The proof is a cockpit test that activates it through the real extension host and prefers it through `ComponentsProvider`, the seam the picker item will use. | `BUILTIN_EXTENSIONS` ships to every user, and production has no preference yet (`app.tsx` passes none), so a built-in example would render nowhere and only grow the bundle. #38 set this precedent. The picker item makes any provided header selectable. | default, reversible |
| Q10 | Which core actions are "the required core actions" the Definition of Done says must still work? | **The task's lifecycle actions and rename.** That means Continue and Stop through the example, Archive from core's bar, and **Rename** through the example's pencil (`onRename()` → core's title editor). Finish, Open in, Notes, Mark unread, Pin, Delete, the tabs and the Run actions menu stay in the shell, untouched. **The meta row's controls are not required.** The example does not declare `shows-meta`, so the branch chip's copy, the reference chips (with **Resolve conflicts**), the automation link, the agent badge (with **Choose engine for the next continuation…**), the diff, usage and the plan mirror leave the task page while it renders. § UI/UX lists each one and where it is still reachable. | The contract makes the meta optional on purpose (`shows-meta`, "the picker says which implementations do"), and the brief asks for Continue, Stop and one custom button, not parity with core's row. Rename is the exception because it is a task action with no other way in: without a pencil it is gone from the page, as it is under the compact example. One button keeps it. | default, reversible |

## 📝 Problem Statement

The brief's goal: prove that the system supports a real override with additional logic. What exists
once #38's changes are on `main` (Q2):

- **An override exists, but it adds nothing.** `examples/compact-task-header/` renders the title,
  the status and `runner · model`, and three buttons that call `onContinue`, `onStop` and
  `onArchive`. It has no state and no behaviour of its own, so it shows that a part can be
  restyled, not that one can be extended.
- **No hook has come from outside `packages/web`.** The compact example is a plain function of its
  props. The fixtures that use hooks (`CoreHeader` and `JiraHeader` in #38's
  `component-host.test.tsx` call `useFailure`) live in the cockpit's own test files, so they share
  the cockpit's React by construction. Hooks in a component from another package only work when
  that package resolves the same React instance. The lockfile keeps one (`react` 19.2.7 since #38),
  but nothing exercises it, and the README does not tell an extension author about it.
- **No real extension takes over some actions and leaves the others.** The owner chose per-action
  takeover (item 11, Q3). On the real page only "all three" is proven. The mixed case exists only
  as a fixture in `run-header.test.tsx`.
- **Rename disappears under a replacement without a pencil.** Core's pencil lives inside core's
  default, and the compact example has none. Item 12's spec (`core-task-header-registration`, in
  review) proves that core's editor opens over a fixture extension's part. No real extension has
  offered rename yet.

The brief's Definition of Done, and where this item proves each point:

| Definition of Done | How this item meets it | Proven by |
|---|---|---|
| The extension header can replace core's header. | Activated through the real extension host and preferred for `cezar.task.header.main`, the example renders in the host's box on `ThreadView`, in place of core's title and meta rows. | `routes/task-thread/jira-task-header.test.tsx` (`data-component="example.jira-header.row"`) |
| It has functionality core does not have. | **Draft Jira issue**: a composer, held in the example's React state, that drafts a Jira summary and description from the header's model and copies them. Core has nothing like it. | `test/jira-task-header.test.ts` (the draft rules), `jira-task-header.test.tsx` (the composer on the page) |
| The required core actions still work (Q10). | Continue executes `cezar.task.continue`. Stop opens core's confirmation, and only **Cancel the run** executes `cezar.task.stop`. Archive stays in core's bar and executes `cezar.task.archive`. The pencil opens core's title editor. The Run actions menu is visible, and lists Continue and Archive for a finished task and Cancel for an active one. The meta row's controls leave the page on purpose, and § UI/UX says where each one is still reachable. | `jira-task-header.test.tsx` |
| It uses no private Cezar imports. | The example imports only `@open-mercato/cezar-extension-api`, `react` and its own files. | `test/boundary.test.ts` (#38's examples rule, unchanged) |

## 📝 Proposed Solution

1. **The draft logic, as a pure function** (`examples/jira-task-header/draft.ts`).
   `draftJiraIssue(model)` takes the header's `task`, `attention`, `engine` and `meta` and returns
   `{ summary, description }`. It is total, deterministic (no clock, no randomness) and needs no
   DOM, so the package's node tests cover it (§ API Contracts gives the rules).
2. **The header part** (`examples/jira-task-header/index.ts`). It is written with `createElement`,
   like the compact example, so the boundary scanner (which reads `.ts` files) covers it and the
   package needs no JSX setting. It shows one row: the title, the status, a pencil, and on the right
   **Continue**, **Stop** and **Draft Jira issue**. Continue and Stop render from `actions.continue`
   and `actions.stop` (hidden unless `available`, disabled unless `enabled`, the `reason` as their
   title) and call `onContinue()` and `onStop()`. The pencil calls `onRename()`. The composer is the
   example's own (§ UI/UX).
3. **The extension** provides the part as `example.jira-header.row` and declares `shows-title`,
   `shows-status`, `offers-continue` and `offers-stop`. It does not declare `offers-archive`, so
   core keeps Archive in its bar. It does not declare `shows-meta` and does not show `meta` or
   `engine`: it uses them only inside the draft. So if the task header's meta row later becomes a
   slot of its own (item 16, being specified), core's row renders under this header and no fact
   shows twice.
4. **The proof on the task page** (`packages/web/src/routes/task-thread/jira-task-header.test.tsx`).
   It builds the page the way `main.tsx` builds it: core commands, the event bus, the core
   component registry, `startExtensionHost` with the example, and a `ComponentsProvider` that
   prefers `example.jira-header.row`. It then drives every Definition of Done point on `ThreadView`.
5. **The README** names the example in its list of worked examples (under "Writing an extension"
   once #38 lands) as the case for a part with its own state and logic. "Replacing a component"
   gains the one rule the example makes visible: React is the cockpit's. An extension imports
   `react` and never bundles its own copy, because a second React makes every hook throw. The host
   then renders core's default in place of that part.

### Prior art

- **Sentry's "Create Jira issue"** needs an installed Jira integration, with OAuth held on the
  server, before it can create anything. That confirms Q6: creating a real issue is a
  credentials-and-permissions feature, not something a header part can do on its own.
- **GitHub's "Reference in new issue"** and the **GitHub Pull Requests and Issues** extension for VS
  Code draft the issue from the context the user is looking at and hand it to the tracker's own
  form. The draft is the valuable part, and the tracker keeps its own create flow. We take the same
  split.
- **Grafana panel plugins** keep their own UI state (a toggled legend, an open menu) and take
  data and callbacks from the host, never querying the data source themselves. That is the shape
  of this example: local state, the host's model, the host's intents.

### Alternatives considered

- **Call Jira's REST API from the example** (Q6). Rejected: it needs a token in the page, a CORS
  exception and a configured site and project. It breaks zero config, and extensions have no secret
  store yet.
- **Open Jira's prefilled create page** (`CreateIssueDetails!init.jspa`). Rejected: it needs the
  site URL plus numeric project and issue-type ids, which is configuration that `context.storage`
  cannot keep yet.
- **Ask the task's agent to write the issue**, through `context.commands.execute(TaskContinue, {
  taskId, text })`. Rejected: it spends tokens on a click, it takes the command token path item 11
  (Q4) closed for header actions, and its result is not something a test can pin.
- **Emit an extension event when a draft is copied** (`example.jira-header.issue-drafted`).
  Deferred: nothing listens to it, and the brief does not ask for it.
- **A native `<dialog>` or a portal for the composer** (Q8). Rejected: `react-dom` is outside the
  examples' boundary, and jsdom 29 does not implement `showModal`.
- **Extend the compact example instead of adding a third.** Rejected: the compact example is the
  minimal "restyle and take over all three" case, which later items can reuse as a baseline.
  Growing it would blur both cases.

## 📝 Architecture

```mermaid
flowchart LR
  ex["examples/jira-task-header<br/>(new: row + composer + draftJiraIssue)"] -.->|"context.components.provide"| reg["component registry<br/>(existing)"]
  test["jira-task-header.test.tsx<br/>(new: host + preference)"] -->|"startExtensionHost, preferenceOf"| reg
  reg -->|"resolveComponent"| host["ComponentHost in RunHeader's shell<br/>(existing, #37 + #38)"]
  host -->|"TaskHeaderMainProps"| ex
  ex -->|"onContinue / onStop / onRename"| model["useTaskHeaderModel<br/>(existing)"]
  model -->|"useCommand"| cmds["cezar.task.continue / .stop<br/>(existing)"]
  model -->|"stop → confirmation, rename → editor"| shell["core's shell<br/>(existing: Archive, Run actions menu)"]
  ex -->|"Copy summary / description"| clip["navigator.clipboard<br/>(browser)"]
```

The example reaches the cockpit only through the registry, and reaches core's behaviour only
through the intents. Its own feature ends at the browser's clipboard.

- **New in `packages/extension-api`:** `examples/jira-task-header/draft.ts` (`draftJiraIssue`),
  `examples/jira-task-header/index.ts` (the extension and its component), and
  `test/jira-task-header.test.ts`.
- **Changed in `packages/extension-api`:** `README.md`. "Writing an extension" lists the example
  with the other two, and "Replacing a component" gains the React-is-the-cockpit's rule.
- **New in `packages/web`:** `src/routes/task-thread/jira-task-header.test.tsx`. It imports the
  example through a test-only relative path, as #38's `external-task-header.test.tsx` does
  (AGENTS.md: "ugly on purpose").
- **Not touched:** the contract, the registry, the resolver, the host, the provider, the shell,
  `useTaskHeaderModel`, the commands, `BUILTIN_EXTENSIONS`, the service, the HTTP contract and
  the api-client. No `BACKWARD_COMPATIBILITY.md` surface moves. If the implementation finds it
  must edit any of these to make the example work, that edit is a finding about the platform. It
  is reported in the PR body, and it should be its own change.

## 📝 Data Model

Nothing is persisted. The example's state lives in its component and dies with it:

| State | Type | Starts as | Reset when |
|---|---|---|---|
| `open` | `boolean` | `false` | the task changes (the component is keyed by `task.taskId`), **Close**, Escape, the button pressed again, a press outside the panel, or the pencil |
| `summary` | `string` | the draft's summary, when the composer opens | the composer opens again |
| `description` | `string` | the draft's description, when the composer opens | the composer opens again |
| `copied` | `'summary' \| 'description' \| null` | `null` | 2 seconds after a successful copy, or on the next copy |
| `copyFailed` | `boolean` | `false` | the next copy, or the composer closing |

The draft includes task content: the title, the prompt, the branch and the references' URLs. All of
it is already in the props that item 10 (Q4a, owner) and item 11 (Q6) let extensions see. It leaves
the page only when the user presses a **Copy** button, and only to the clipboard.

## 📝 API Contracts

No public contract changes: the example uses `cezar.task.header.main@1` exactly as #37 and #38
define it. The example's own module surface is shown below. It is not part of the package's public
API, because `src/index.ts` does not re-export `examples/`.

### `examples/jira-task-header/draft.ts` (new)

```ts
import type { TaskHeaderMainProps } from '@open-mercato/cezar-extension-api'

/** Jira's summary field holds at most 255 characters. */
export const JIRA_SUMMARY_MAX = 255
/** Jira's description field holds 32,767. The draft stays under it with room for the user's own edits. */
export const JIRA_DESCRIPTION_MAX = 32_000

export interface JiraIssueDraft {
  readonly summary: string
  readonly description: string
}

/** The model a draft is made from: the header's props without the intents or the action state. */
export type JiraDraftInput = Pick<TaskHeaderMainProps, 'task' | 'attention' | 'engine' | 'meta'>

/** Drafts a Jira issue from what the task header shows. Total and deterministic: it never throws, reads no clock and touches no DOM. */
export function draftJiraIssue(input: JiraDraftInput): JiraIssueDraft
```

The rules, each one pinned by a test:

- **Summary.** `task.title` with its whitespace collapsed and trimmed. A title that is blank after
  that gives `Cezar task <taskId>`. A summary longer than 255 UTF-16 units (JavaScript's `length`,
  which is how Jira's Java backend counts) is cut to at most 254 units plus `…`, and the cut never
  splits a surrogate pair: a dangling high surrogate at the cut is dropped too.
- **Description.** It is plain text, not Jira wiki markup or Markdown, so it pastes the same into
  Jira Cloud's editor, Jira Data Center and anything else. The lines come in this order, and a line
  whose fact is absent is left out:

  ```text
  Drafted from Cezar task <taskId> in project <projectId>.

  Status: <attention.label>[ #<queuePosition>]
  Agent: <engine.runner> · <engine.model>[ (<engine.identity>)]
  Workflow: <meta.workflow>
  Branch: <meta.branch>
  Changes: +<added> −<removed> across <files> file(s)[, measured against a branch the agent checked out]
  Pull request #<number>[ (<status>)]: <url>
  Issue #<number>: <url>

  Original request:
  <task.prompt>
  ```

  ` in project <projectId>` is left out when `projectId` is `''` (a bare test render). References
  keep `meta.references`' order. A reference without a number reads `Pull request: <url>`, and one
  without a URL reads `Pull request #<number>`. A reference `status` is written only when it is one
  of the values the contract documents today, because the contract says to read an unknown value as
  absent. It is written as `(<status>)` while `lookup` is `ready` or absent, as `(last known:
  <status>)` while `lookup` is `unavailable`, and not at all while `lookup` is `loading` or
  `unknown`. The account and usage are never written: who ran the task and what it cost are not
  facts about the issue.
- **Limit.** The description never passes `JIRA_DESCRIPTION_MAX`. The original request is cut
  first, ending with `… (cut to fit Jira's description limit)`. If the lines above it still do not
  fit (only a task with hundreds of references can get there), the request is left out, and the
  reference lines are cut from the end and replaced by `… and <n> more references`. The status,
  agent, workflow, branch and changes lines are never cut.

### `examples/jira-task-header/index.ts` (new)

```ts
import { createElement as h, useEffect, useRef, useState } from 'react'
import { defineExtension, TaskHeaderMain, type ComponentProps } from '@open-mercato/cezar-extension-api'
import { draftJiraIssue } from './draft.ts'

type Props = ComponentProps<typeof TaskHeaderMain>

/** Keys the row by task, so moving to another task (the host does not remount) drops the draft. */
function JiraTaskHeader(props: Props) {
  return h(JiraTaskHeaderRow, { ...props, key: props.task.taskId })
}

function JiraTaskHeaderRow(props: Props) { /* the row and the composer, § UI/UX */ }

export default defineExtension({
  // `>=0.11.2`: the first release after 0.11.1 can ship `cezar.task.header.main@1` with `offers-*`.
  manifest: { id: 'example.jira-header', name: 'Jira task header (example)', version: '1.0.0', engines: { cezar: '>=0.11.2' } },
  activate(context) {
    context.components.provide(TaskHeaderMain, {
      id: 'example.jira-header.row',
      title: 'Row with a Jira draft',
      capabilities: ['shows-title', 'shows-status', 'offers-continue', 'offers-stop'],
      component: JiraTaskHeader,
    })
  },
})
```

`./draft.ts` follows the package's own relative-import style (`allowImportingTsExtensions`, as
`src/` imports `./commands.ts`).

**The example compiles under two configurations, and must pass both.**
`packages/extension-api/tsconfig.test.json` typechecks `examples/` with no DOM types (`lib:
["ES2022"]` plus Node's types). There, React's fallback `HTMLInputElement` is an empty interface,
so `event.target.value` does not compile. `npm run typecheck`'s web pass also compiles the example,
because `jira-task-header.test.tsx` imports it, and that pass has the DOM. There, a ref typed
`{ focus(): void; select(): void }` on an `input` that also has an inferred `(event) => …` handler
fails overload resolution (TS2769). The shape that passes both, checked with the repository's `tsc`
during this review:

- the clipboard is read as `(globalThis as { navigator?: { clipboard?: { writeText(text: string):
  Promise<void> } } }).navigator?.clipboard`;
- refs are `useRef<{ focus(): void; select(): void } | null>(null)`;
- every handler's parameter is typed structurally, e.g. `(event: { currentTarget: unknown })`, and
  a field's value is read as `(event.currentTarget as { value: string }).value`. Keys are read
  from `(event: { key: string })`.

The example never widens the package's `lib`, because that would let a DOM global into `src/` as
well.

## 📝 UI/UX

**The row.** Left to right: the title (bold, cut with an ellipsis, the prompt as its hover text),
the status as `attention.label` with `#<queuePosition>` for a queued task and a dot coloured by
`attention.tone` (an unknown tone reads neutral), and a pencil (`aria-label="Rename task"`). On the
right: **Continue**, **Stop** and **Draft Jira issue**. Continue and Stop follow their action state
exactly as core's buttons do: hidden while not `available`, disabled while not `enabled` (so also
while `pending`), and `reason` as the hover text. The row is at least 30 px high, the contract's
`minBlockSize`. The title shrinks first on a narrow screen, and the buttons keep their size.

**The shell around it** (core's, unchanged): Archive, Finish, Open in, Notes, Mark unread, Pin and
Delete in the desktop bar, without Continue and Cancel, which the example offers. The **Run
actions** menu (⋮) is visible at every width while the example renders, and it still lists the
task's actions (#38): Continue and Archive for a finished task, Cancel for an active one.

**What this header does not show** (Q10). It does not declare `shows-meta`, so none of core's meta
row renders while it does. Each control is still reachable elsewhere, except the branch copy:

| Core's meta-row control | While this header renders |
|---|---|
| Reference chips with live status, and **Resolve conflicts** | The Tasks table (`tasks-overview.tsx`) and the global task list show the same chips and the same conflict action |
| **Choose engine for the next continuation…** (badge menu) | The dock's engine picker on the Session tab, which that item only moved focus to (item 11, Q7) |
| Automation link | The Automations page |
| Branch chip (copy) | Not on the task page. The draft's description carries the branch |
| Workflow, diff, tokens and cost, runner · account · model, plan mirror | Facts, not actions. Not on the task page. The draft's description carries the workflow, the diff and the agent |

**The composer.** **Draft Jira issue** (`aria-expanded`, `aria-controls`) opens a panel under the
row, anchored to the row's right edge and never wider than the row: `width: min(28rem, 100%)` of
the example's own positioned wrapper. At 375 px core's ⋮ menu sits to the right of the row, so the
row is roughly 300 px wide and the panel fits inside it. The panel is absolutely positioned, so the
header keeps its height. While open it covers what lies under it, core's tabs and action bar
included, so it closes on **Close**, Escape, its button, and a press anywhere outside it. It is
`role="dialog"` with the label "Jira issue draft", and is not modal: nothing traps focus. It
holds:

- **Summary**, a one-line input seeded with the draft's summary (`maxLength` 255), and **Copy
  summary** beside it;
- **Description**, an eight-row textarea seeded with the draft's description, and **Copy
  description** beside it;
- a line saying what the buttons do, "Copies to the clipboard. Nothing is sent to Jira.", and
  **Close**.

States:

| State | What the user sees |
|---|---|
| Opened | Focus moves to Summary. Both fields hold a fresh draft from the header's current props. |
| Copied | The pressed button reads **Copied** for 2 seconds, and an `aria-live="polite"` region says "Summary copied" or "Description copied". |
| Copy failed | The browser refused, or has no clipboard (an insecure origin). The line under the fields reads "Copy failed. Select the text and copy it yourself.", the field's text is selected, and nothing throws. |
| Closed | **Close**, Escape inside the panel, or **Draft Jira issue** pressed again: focus returns to **Draft Jira issue**. A press outside the panel (a `pointerdown` listener on the document, added while the panel is open and removed in the effect's cleanup): focus stays where the user pressed. Either way the edits are dropped, and the next open drafts again from the current props. |

The pencil closes the composer before it calls `onRename()`. Core's editor then covers the row's
top 30 px, and the part is `inert` and hidden until the user saves or cancels (item 11, Proposed
Solution §6).

Accessibility: every control is a native `button`, `input` or `textarea` with a visible label or
an `aria-label`. Escape and focus return are handled as above, and the panel's copy feedback is
announced.

Colours: inline styles only, with CSS system colours (`Canvas` and `CanvasText` for the panel,
`ButtonFace` and `ButtonText` for its buttons, `GrayText` for hints), `font: inherit` everywhere,
and a 1 px `GrayText` border. The cockpit sets `color-scheme: dark` on `:root` and `light` on
`.light`, so the panel follows the theme without reading the cockpit's private tokens. The status
dot's five colours are the example's own constants.

Prototype: `.ai/specs/assets/custom-task-header-extension/`. `current-01-task-header.png` is
today's task page. `mockup-01-jira-header.png` shows the example's row on the task page, with
core's bar keeping Archive and the Run actions menu beside the part. `mockup-02-jira-composer.png`
shows the composer open with a drafted issue. The `.html` sources sit beside them. They are
illustrations, not the implementation's pixels.

## 📝 Edge Cases & Failure Scenarios

- **The user moves from task A to task B.** The host does not remount a healthy implementation
  (`component-host.tsx`, `resetKey`). The example keys its row by `task.taskId`, so B's header opens
  with the composer closed and no trace of A's draft.
- **The props change while the composer is open** (the task finishes, a PR appears). The fields keep
  what was drafted when the composer opened, because the user may have edited them. Closing and
  opening it again drafts from the current props.
- **The clipboard is unavailable or refuses** (a plain-http remote origin, a denied permission). The
  example catches the rejection itself, since an error boundary does not catch handler or promise
  errors (README). It shows the failure line and selects the text, and nothing else changes.
- **Continue or Stop cannot run** (a running task cannot continue, a request is pending, no
  provider is connected). The button follows `actions`: hidden, disabled, or disabled with the
  reason. Core checks the state again on every intent (item 11, Q4), so a call at the wrong time
  sends nothing.
- **Stop without the user asking.** `onStop()` only opens core's confirmation, so the task stops
  only on **Cancel the run**.
- **The example throws while rendering.** The host renders core's default (#32), and the shell sees
  the failure through `useHostedComponent`, so the bar shows Continue and Cancel again. #38's
  `run-header.test.tsx` pins this with a throwing fixture, and this item does not prove the
  platform again. `draftJiraIssue` runs in the click handler that opens the composer, not during
  render, and it is total, so a draft cannot take the row down.
- **The copy feedback's timer.** The 2-second **Copied** timer is cleared in the effect's cleanup,
  so a task switch, a deactivation or React's development double-mount leaves no timer behind that
  sets state on an unmounted row.
- **The example deactivates while the composer is open.** Core's default takes its place without a
  notice (README), and the unsent draft is gone. Nothing was persisted, so nothing is left behind.
- **A second copy of React.** An extension that bundles its own React breaks on its first hook
  call. The host catches the render error and falls back to core's default. In this repository the
  example resolves the cockpit's single `react` (#38 pins the devDependency to `packages/web`'s
  range), and the cockpit test proves it: the composer only opens if `useState` works. The README
  states the rule for authors outside the repository.
- **A long title or prompt.** The row cuts the title with an ellipsis. The summary is cut at 255
  characters, and the prompt is cut so the description stays under 32,000 (§ API Contracts).
- **Unknown strings in the props** (a new reference status, a new tone). The draft leaves out a
  status it does not know, and the dot reads neutral, as the contract asks.
- **Rename while the composer is open.** The pencil closes the composer first, so core's editor
  never hides an open panel it cannot reach.
- **Before #38 is on `main`.** `offers-continue` and `offers-stop` are unknown to the token, and the
  registry ignores unknown capability names (README), so core's bar would show Continue and Cancel
  beside the example's. Step 0 stops the implementation there (Q2).
- **The intents the example does not use** (`onArchive`, `onResolveConflicts`, `onNavigate`,
  `onChooseEngine`). It never calls them. Archive stays in core's bar, and § UI/UX lists where the
  meta row's controls stay reachable.
- **The panel covers core's tabs and bar while open.** That is the price of not changing the
  header's height. Any press outside the panel closes it. A press on a tab or a button the panel
  does not cover also reaches that control, because the listener only observes `pointerdown` and
  never cancels it. What the panel covers cannot be pressed until the user closes it.

## 📝 Risks & Impact Review

- **No runtime change to the cockpit.** The example is not in `BUILTIN_EXTENSIONS` (Q9), so no user
  runs it. The whole change is a new example, its tests and a README paragraph. Rollback is deleting
  them.
- **The dependency on #38 (Q2).** The implementation cannot start until #38's changes are on
  `main`. Re-landing them is the owner's call. If the owner drops #38 instead, or re-lands it
  changed (for example with other capability names), this spec is revised first. It never grows
  a fallback that would carry runtime changes into an example PR.
- **The meta row leaves the page under this header (Q10).** That is what `shows-meta` being
  optional means, and § UI/UX says where each control stays reachable. The branch copy is the one
  control with no other place. Nobody meets this before the picker item, because nothing in
  production selects the example (Q9). When the picker lists the example, it says the example does
  not show the meta.
- **The first hook in an extension component.** This makes "one React for the cockpit and its
  extensions" a tested fact where it was an assumption. The rule is not enforced for external
  bundles, which do not exist yet (the extension API package is private). The README is where an
  author learns it.
- **"Jira" in an example that never talks to Jira (Q6).** The button's label and the composer's
  line ("Nothing is sent to Jira.") say what it does. If the owner wants a real integration, it is a
  new item that depends on extension storage, secrets and the permission model (#40), not an edit of
  this example.
- **Task content on the clipboard.** The prompt can hold anything the user typed. It reaches the
  clipboard only when the user presses **Copy description**, after seeing it in the textarea. No
  request, event or log carries it.
- **Test weight.** One new cockpit test file boots the page as #38's does (about 200 lines). It adds
  no new wrapper or fixture to other tests.

## 📋 Phasing

One phase, one PR, once #38's changes are on `main`. Step 0 is a check, steps 1 to 4 each leave the
gate green, and step 5 is visual evidence that is never committed.

## 📋 Implementation Plan

Every step keeps the validation gate in `.ai/agentic.config.json` green: typecheck, `npm test`,
`test:unit`, `build` and `test:package`.

0. **Check the prerequisite.** `TaskHeaderMain.optionalCapabilities` on `main` includes
   `offers-continue` and `offers-stop`, `useHostedComponent` exists in `component-host.tsx`, and
   `boundary.test.ts` lets examples import `react`. If any is missing, stop and report that #38 has
   not landed (Q2). This item brings none of them itself.

1. **The draft** (`examples/jira-task-header/draft.ts`).
   *Tests* (`packages/extension-api/test/jira-task-header.test.ts`, node):
   - a full model gives the description line by line, in the documented order;
   - a minimal model (no branch, diff, references or identity; `projectId: ''`) gives only the lines
     it can, with no blank "Branch:" or "project" fragment;
   - the summary collapses whitespace, falls back to `Cezar task <taskId>` for a blank title, is cut
     to at most 255 UTF-16 units with `…`, and a cut that falls inside an emoji leaves no lone
     surrogate;
   - a reference without a number, one without a URL, a documented status, and an unknown status
     (left out). A status reads `(last known: …)` under `lookup: 'unavailable'` and is left out
     under `loading` and `unknown`;
   - `repointed` adds the caveat, and one file reads `1 file`;
   - a prompt that would push the description past 32,000 characters is cut with the marker, with
     the facts above it intact. With enough references to fill the limit on their own, the request
     is left out and the list ends with `… and <n> more references`. Every result is at most
     32,000 characters;
   - the same input twice gives equal output, and the account and usage never appear.

2. **The extension and its component** (`examples/jira-task-header/index.ts`).
   *Tests* (same file):
   - activated with `createFakeContext`, it provides exactly one implementation,
     `example.jira-header.row`, against `cezar.task.header.main@1`;
   - `checkComponentCompatibility(TaskHeaderMain, impl).capabilities` is
     `['shows-title', 'shows-status', 'offers-continue', 'offers-stop']`: compatible, with no
     `offers-archive` and no `shows-meta`;
   - `test/boundary.test.ts` passes unchanged. It finds the example's value import of `react` and
     no other outside import;
   - the example typechecks under both `packages/extension-api/tsconfig.test.json` (no DOM) and the
     web pass of `npm run typecheck` (with the DOM, through step 3's import), with the structural
     handler types § API Contracts gives.

3. **The proof on the task page** (`packages/web/src/routes/task-thread/jira-task-header.test.tsx`).
   It builds the page as `main.tsx` does and prefers the example, like `external-task-header.test.tsx`.
   `navigator.clipboard.writeText` and `fetch` are stubbed, and the command registry is spied on.
   *Tests:*
   - **Replaces core's part:** the host's box has `data-component="example.jira-header.row"`, shows
     the title and the status label, and core's default is not rendered;
   - **Core's actions, through core,** over two renders, as #38's test does. With a finished run,
     the example's Continue executes `cezar.task.continue` with `{ taskId }`. Archive in core's bar
     executes `cezar.task.archive`. The bar has no Continue, and the Run actions menu (no
     `md:hidden`) lists Continue and Archive. With a running run, the bar has no Cancel, the menu
     lists Cancel, and the example's Stop opens core's confirmation. Nothing runs on **Keep it**, and
     **Cancel the run** executes `cezar.task.stop`;
   - **Rename:** the example's pencil calls `onRename()`, core's title editor
     (`data-slot="title-editor"`) opens over the part, and Escape restores the example's row. Item
     12's spec proves the editor under a fixture extension. This case adds only the real
     extension's own pencil. Whichever item lands second keeps just the assertions the other does
     not make;
   - **Its own feature and state:** **Draft Jira issue** opens the composer (`aria-expanded`), with
     Summary focused and seeded with the title, and a Description holding the branch and PR lines.
     An edited summary survives a re-render with the same task. **Copy summary** writes the edited
     summary to the clipboard, and the button reads **Copied**. During the whole draft-and-copy
     flow no command is executed and **no non-GET request is sent**. GETs are not counted: the
     fixture's pull request starts the reference-status look-up, whose failed parse of the stub's
     `{}` is retried about a second later (`query-client.ts`), inside the flow;
   - **Layout, as far as jsdom can see it:** the panel's inline style is `position: absolute` with a
     width bounded by `100%` of the example's wrapper, and the row's wrapper is `position: relative`.
     The visual claims (the header keeps its height, the panel stays on screen at 375 px) are step
     5's;
   - **Failure:** a rejecting clipboard, and a page with no `navigator.clipboard` at all, each show
     the failure line with no unhandled rejection, and the task page keeps working;
   - **Per task:** re-rendering `ThreadView` with another run (no remount) shows the composer
     closed, and opening it drafts from the new run;
   - **Closing:** Escape in the panel closes it and returns focus to **Draft Jira issue**. A
     `pointerdown` outside the panel closes it, and one inside does not. After unmount no
     `pointerdown` listener is left on the document.

   Prove each new test red first, per AGENTS.md: comment out the example's `offers-stop` and the
   "bar has no Cancel" assertion fails, drop the `key` and the per-task test fails, remove the catch
   around the clipboard call and the failure test fails. Restore each, and record the three results
   in the PR body.

4. **The README** (`packages/extension-api/README.md`). "Writing an extension", where #38 lists the
   worked examples, names all three and what each shows: `hello-extension` is the extension's
   lifecycle, `compact-task-header` restyles the part and takes over all three actions, and
   `jira-task-header` adds a feature with its own React state and takes over two. "Replacing a
   component" gains the rule: import `react`, never bundle a copy, because a second React breaks
   every hook and the host then renders core's default. AGENTS.md is unchanged: once #38 lands, the
   extension-api row already scopes "React through `import type` only" to `src/`.

5. **Visual evidence, never committed.** jsdom has no layout, so the height and on-screen claims
   are checked in a real browser. On a local, uncommitted patch, list the example in
   `BUILTIN_EXTENSIONS` and pass `ComponentsProvider` a `preferenceOf` that names
   `example.jira-header.row`. Run `CEZ_DRY_RUN=1 npm run dev`, and capture the task page with the
   composer closed and open, at 1280 px and at 375 px, for a finished and for a running dry-run
   task. The screenshots must show that the header's height is the same with the panel open and
   closed, that the panel stays inside the viewport at 375 px, and that it is readable in light and
   dark. Attach them to the implementation PR as evidence, then discard the patch. `git diff
   --stat` must show neither file changed before the commit.
