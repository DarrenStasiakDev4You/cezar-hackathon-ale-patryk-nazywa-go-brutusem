# Generic Component Settings UI — controls generated from an implementation's settings schema

> Slug: `generic-component-settings-ui` · Status: **designed, awaiting implementation** · Epic 2
> (Component Platform). Builds on `2026-09-19-component-settings-api.md` (shipped in PR #50),
> `2026-09-19-component-registry.md`, `2026-09-19-component-resolver.md`,
> `2026-09-19-component-host.md` and `2026-09-19-component-implementation-preferences.md`.
> This is the picker/form item that the settings-API spec deferred: "A later picker item may
> inspect the declarative definition, render supported field types and call the host-side registry
> methods for partial updates and reset."

## 📝 TLDR

An implementation can already declare settings (`defineSettings({ scope, schema })`) and Cezar
already validates, persists, scopes and resets them — but nothing renders them, so a value can only
be changed by editing `ui-state.json` by hand. This item proposes a **Components** section in
Settings that reads each registration's declared schema and generates the controls from it:
a switch for `boolean`, a text field for `string`, a number field for `number` and a dropdown for
`select`. An extension author declares fields; Cezar renders the form, writes through
`registry.setSettings()` and the running component re-renders with the new value. No per-extension
UI code is written on Cezar's side, and no custom renderer API is introduced yet.

## 📝 Problem Statement

Today the component platform can configure nothing. `packages/web/src/component-registry/registry.ts`
exposes `getSettings`/`setSettings`/`resetSettings`, the persistent store writes both scope files,
and `ComponentHost` hydrates `useComponentSettings()` — but the settings-API item deliberately
shipped **"None in this item. There is no settings page, picker, form generator or new route."**
The result is a complete write path with no writer: an extension that declares `compact: false` has
no way for its user to turn it on.

Two gaps follow from that, and both are in scope here:

- **No surface.** `SETTINGS_SECTIONS` (`packages/web/src/routes/settings/registry.tsx`) has no entry
  for components, so `/p/<projectId>/settings/` lists Agents, Agent config, Worktrees, Bookmarklets
  and Prompt templates and nothing that reaches a component.
- **No vocabulary.** The declarative schema is boolean-only end to end — `booleanSetting()` in
  `packages/extension-api/src/components.ts`, `snapshotSettingsDefinition`/`sparseSettings` in the
  registry, `isBooleanMap` in `settings.ts` and `z.record(z.string(), z.boolean())` in
  `packages/contract/src/workspace.ts`. A settings UI with one control type is not a settings UI;
  the brief's four types are the minimum useful vocabulary.

The Definition of Done is one capability with three coupled guarantees:

| Requirement | Required behavior | Proof |
|---|---|---|
| An example implementation declares settings | The `compact-task-header` example declares one field of each supported type, with no Cezar-side code that knows about it. | `packages/extension-api/test/compact-task-header.test.ts` asserts the declared schema; the cockpit test activates the example through the real extension host. |
| The user changes a value in Settings | Settings → Components lists every configurable implementation and renders its controls from the schema alone; changing one persists through `registry.setSettings()` to the declared scope's UI-state file. | Section test flips a switch, edits a text and a number field and picks a select option, and asserts the store received the canonical sparse override. |
| The component reacts | The rendered implementation shows the new value without a reload. | A cockpit test renders the section and the task header together, changes a setting and asserts the header's output changes. |

The third guarantee needs no new mechanism: a store write already calls `changed()` in the registry,
which bumps `revision()`, and `SettingsImplementation` in `component-host.tsx` re-reads on every
revision. This item must not break that chain — it is the DoD.

## Resolved assumptions (autonomous defaults)

This spec was written unattended by `om-auto-write-spec`; the questions that would have gated an
interactive run are answered below. Each is reversible before merge — correct any row and the
design follows.

| # | Question | Applied default | Why | Confirm? |
|---|---|---|---|---|
| Q1 | Where does the form live — a new Settings section, or inside the component-overrides UI (PR #58)? | **One new section, `components`, at project scope** (`/p/:projectId/settings/components`), declared once in `SETTINGS_SECTIONS`. If #58's override picker lands under the same id, the generated form mounts inside its per-implementation card rather than becoming a second section. | `resolveComponentProjectId()` reads the project from a `/p/<id>/` URL, so a **project**-scoped definition can only be written from a project URL; a global-scope section could never edit half the settings it lists. One id keeps "components" a single destination. | reversible |
| Q2 | Which field types ship, and as what public API? | **`boolean` (exists) plus `stringSetting`, `numberSetting`, `selectSetting`**, each an additive descriptor with optional `label`/`description` and its own bounds. No other type, no free-form JSON field. | Exactly the brief's four. Additive to `defineSettings`, so every implementation written against the boolean-only API keeps compiling. | reversible |
| Q3 | Does the persisted value type widen beyond boolean? | **Yes** — `componentSettingsSchema` values become `boolean \| string \| number`, with a 256-character string cap and a 32 KiB cap on the whole map. Existing boolean files parse unchanged. | Storing a string as a boolean is not possible; the schema is an additive widening of an optional UI-state key, and BACKWARD_COMPATIBILITY.md §2 records the new shape in the same PR. | reversible |
| Q4 | Save on change, or an explicit Save button? | **Both, split the way this repo already splits them**: a switch or a dropdown writes on change; a text or number field is edited locally and saved with the card's **Save** button, disabled until the card is dirty and valid, with the invalid rule shown inline. | That is the house rhythm, not a compromise: Appearance's segmented controls write on change, while Resources' memory limit and monitoring interval (`resources-section.tsx:220,273`) and Worktrees' retention (`worktrees-section.tsx:116`) all use a dirty-and-valid-gated Save. A debounced write for typed fields would be a new mechanism with no precedent in Settings. | reversible |
| Q5 | How is "the user changes it and the component reacts" proven, given no extension ships in the cockpit today? | **Through the cockpit's own test of the real extension host** — the `compact-task-header` example is activated, the section is rendered, a control is changed and the header's output is asserted. `BUILTIN_EXTENSIONS` stays empty, so the released cockpit gains no example extension. | Shipping an example extension to every user is a product decision beyond this brief, and the platform's other items (task header, composer, capability validation) all proved themselves this way. Manual verification is documented: add the example to `BUILTIN_EXTENSIONS` locally and run `CEZ_DRY_RUN=1 npm run dev`. | reversible — **override this row if the DoD means clicking it in the shipped cockpit**; the change is then one line in `builtin-extensions.ts` plus a QA pass |
| Q6 | Does this item add the "custom settings renderer" the brief anticipates? | **No.** The renderer is an internal table keyed by descriptor `type`, private to the cockpit. An unknown type renders as a disabled, read-only row naming the type. | Smallest surface that ships something working; a public renderer API would be a second extension contract (component-contract shaped) and deserves its own item. The internal table is where it would attach. | reversible |
| Q7 | Does the section also list implementations with no settings, or offer the override picker? | **No** — only implementations that declare a settings definition, grouped by contract. | Scope cohesion: choosing which implementation renders is `2026-09-19-component-implementation-preferences` / PR #58. Listing unconfigurable rows would make the section's empty state meaningless. | reversible |
| Q8 | The item changes the public extension API, a protected UI-state shape **and** adds a Settings surface. Split it? | **No, ship it as one item** — but in the phase order below, where phase 3 alone is deployable against today's boolean-only API. | The brief names the four control types as the deliverable, and a boolean-only picker would be shipped and immediately rewritten. The split line, if the owner wants one, is exactly phase 3 (the section, booleans) versus phases 1–2 (the vocabulary and its persistence) — the phases are written so either order works. | reversible — this is a product call about the brief's scope, not a design constraint |
| Q9 | A stock cockpit has no configurable implementation. Does the nav entry still appear? | **No.** The section is always *routed* (a pasted URL shows the empty state), but the nav and the Settings index **omit** it while no registration declares settings. `visibleSettingsSections` gains an `omit` argument and the shell computes it from the live registry. | A permanent nav entry that can never show anything for any user is a dead end, and the alternative — giving a core implementation a setting it does not need — trades a working default for a knob (AGENTS.md § Zero config). Visibility is discovered from the registry, like every other capability here. | reversible |

## 📝 Proposed Solution

1. **Grow the declarative vocabulary** in `packages/extension-api/src/components.ts`: three new
   descriptor helpers beside `booleanSetting`, one discriminated union
   (`ComponentSettingDefinition`), one value union (`ComponentSettingValue`) and an `InferSettings`
   that maps each descriptor to its TypeScript type. Optional `label` and `description` on every
   descriptor are what make a generated form readable; the UI falls back to a humanized key.
2. **Keep the host the validator, and stop a settings mistake from costing a component.**
   `snapshotSettingsDefinition` already re-derives the definition from untrusted extension input and
   today rejects anything non-boolean; it grows the same re-derivation for the new descriptors,
   bounds and the new `label`/`description` included. A new `canonicalSettings()` replaces
   `sparseSettings()`'s boolean check and validates the parsed value against the **snapshotted**
   schema — an extension-supplied `parse()` that returns a 10 KB string never reaches the wire.
   One behavior change comes with it: today a definition the host cannot re-derive makes `prepare`
   throw `invalid-input` (`registry.ts:432`) and `provide` does not catch it, so an extension built
   against a newer extension-api loses its **whole component**, not just its settings. From this item
   an extension's unrecognizable definition registers the implementation **without settings** and
   records the issue; core's `register` still throws, because that is the author's own mistake.
3. **Widen persistence by one union.** `componentSettingsSchema` in `packages/contract/src/workspace.ts`
   accepts `boolean | string(≤256) | number(finite)`, keeps the 64-field and 200-entry caps and adds
   a serialized-size cap; `isBooleanMap` in `settings.ts` becomes a settings-value guard. No new
   route: both scopes keep using the existing UI-state families.
4. **Generate the form.** A new `packages/web/src/routes/settings/component-settings-section.tsx`
   asks `listComponentChoices(registry, contract)` for each contract in `CORE_COMPONENT_CONTRACTS`
   — the reader AGENTS.md mandates, which already returns compatible implementations sorted by id and
   keeps the incompatible ones apart — keeps those that carry a `settings` definition, and renders one
   card per implementation with one row per field. The control comes from a private renderer table
   keyed by descriptor `type`; every write goes through `registry.setSettings(componentId, patch)` and
   every reset through `registry.resetSettings(componentId, key?)`, and a successful write invalidates
   both UI-state query keys so the rest of the cockpit does not keep a stale snapshot. The section
   knows nothing about any extension.
5. **Prove it on a real extension.** The `compact-task-header` example declares four settings (one
   per type) and renders from them, so the DoD's three guarantees are asserted against extension
   code that Cezar has never special-cased.

### Prior art

- [VS Code's Settings UI](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration)
  renders every extension setting from `contributes.configuration` — `boolean`, `string`, `number`,
  `enum` with `enumDescriptions` — and shows a "modified" marker with a per-setting reset. This item
  copies the four types and the per-field reset, and skips the settings search, the JSON editor and
  the per-language overrides.
- [Grafana plugin configuration pages](https://grafana.com/developers/plugin-tools/how-to-guides/app-plugins/add-configuration-page)
  let a plugin ship its own React config page. Rejected as the default here for the same reason the
  settings-API item rejected extension-owned writes: a generated form keeps validation, persistence
  and reset in one host-owned lifecycle. The plugin-owned page is what a later custom-renderer item
  would add, behind the same table.
- [Backstage configuration](https://backstage.io/docs/frontend-system/building-apps/configuring-extensions/)
  keeps extension config in a YAML file with no UI at all — the state Cezar is in today, and the one
  this item leaves.

### Alternatives considered

- **Put the form behind the override picker only (#58).** Rejected as the *only* home: settings must
  be reachable for the implementation already selected, including core's default, not only while
  choosing a replacement. The two surfaces share one section instead.
- **A global-scope section.** Rejected: project-scoped definitions resolve their project from the
  URL, so `/settings/global/components` could read and write only half of them and would have to
  render the rest as unavailable — a section that is broken by design for one of its two scopes.
- **Let the extension ship a React settings component.** Rejected for this item (see prior art):
  it is a second component contract, a second isolation boundary and a second failure mode, for a
  need the four generated types cover. The renderer table is the seam it would attach to.
- **A JSON textarea per implementation.** Rejected: it is `ui-state.json` with extra steps — no
  labels, no validation before the write, no reset, no discoverability.
- **Explicit Save per card.** Rejected (Q4): every other Settings section saves on change, and a
  draft buffer would have to reconcile with the revision-driven re-read that makes the component
  react in the first place.
- **Add `label`/`description` as a separate metadata map.** Rejected: a field's label belongs on the
  field. Optional properties on the descriptor keep one object to validate and one to render.

## 📝 Architecture

```mermaid
flowchart LR
  ext["extension implementation (existing)\ndefineSettings({ scope, schema })"] --> reg
  subgraph new["new in this item"]
    types["extension-api descriptors\nstring / number / select"]
    section["Settings → Components\ncomponent-settings-section.tsx"]
    fields["renderer table\nby descriptor type"]
  end
  types -.declares.-> ext
  reg["component registry (existing)\nsnapshot + canonicalize + set/reset"] --> store["settings store (existing)\nworkspace / project ui-state"]
  section --> reg
  section --> fields
  store -->|"revision bump"| host["ComponentHost (existing)\nuseComponentSettings()"]
  host --> rendered["the running implementation\nre-renders with the new value"]
```

Takeaway: the only new runtime path is *Settings section → `registry.setSettings`*. Everything after
the write — canonicalization, persistence, the revision bump and the re-render — is the machinery
PR #50 already shipped, which is why "the component reacts" costs no new mechanism and why breaking
the revision chain would be the one silent way to fail this item.

### Modules and ownership

- `packages/extension-api/src/components.ts` — the three new descriptors, their helpers, the
  descriptor/value unions and the widened `InferSettings`. `src/index.ts` re-exports them and
  `test/surface.test.ts` is edited deliberately, as a new runtime export must be.
- `packages/web/src/component-registry/registry.ts` — `snapshotSettingsDefinition` re-derives the new
  descriptors and their bounds; `canonicalSettings()` (renamed from `sparseSettings`) validates the
  parsed value against the snapshotted schema before persistence. No change to `getSettings`,
  `setSettings`, `resetSettings` or `forExtension`'s surface.
- `packages/web/src/component-registry/settings.ts` — the map guard accepts the widened value union,
  `update()` makes one implementation's read-modify-write atomic inside the write queue, and reads of
  one target are deduplicated while one is in flight (see Risks: the section reads once per
  configurable implementation).
- `packages/contract/src/workspace.ts` — `componentSettingsSchema` widens its value type and gains a
  serialized-size bound. Both UI-state shapes keep their open sibling-key behavior.
- `packages/web/src/routes/settings/component-settings-section.tsx` (new) — the section: discovery
  through `listComponentChoices`, grouping with the contract display-name map, per-card edit state,
  writes, resets, UI-state query invalidation and the unavailable/empty states.
- `packages/web/src/routes/settings/component-settings-field.tsx` (new) — the renderer table and the
  four controls, built from the cockpit's existing `Switch`, `Input`, `Select` and `Label` primitives
  and the `SettingsField` rhythm.
- `packages/web/src/routes/settings/registry.tsx` — one `SETTINGS_SECTIONS` entry (`components`,
  project scope), one `SettingsSectionId` member, and the `omit` argument on
  `visibleSettingsSections`; `settings-shell.tsx` computes `omit` from the live registry so the entry
  appears only when something is configurable.
- `packages/extension-api/examples/compact-task-header/index.ts` — the worked example gains four
  settings and reads them through `useComponentSettings()`.
- Docs: `packages/extension-api/README.md` (the settings paragraph), the component-settings row in
  `AGENTS.md`, and `BACKWARD_COMPATIBILITY.md` §2's `componentSettings` paragraph.

No server module changes: the section writes through the existing
`PUT /api/v1/workspace/ui-state` and `PUT /api/v1/p/:projectId/ui-state` routes that the settings
store already uses. No new route, no new query key family, no new event topic.

## 📝 Data Model

### Descriptors (public, `@open-mercato/cezar-extension-api`)

```ts
export interface SettingFieldMeta {
  /** Shown as the control's label. Absent: the humanized key ("showToolCalls" → "Show tool calls"). */
  readonly label?: string
  /** One line under the label. */
  readonly description?: string
}

export interface BooleanSettingDefinition extends SettingFieldMeta {
  readonly type: 'boolean'
  readonly default: boolean
}

export interface StringSettingDefinition extends SettingFieldMeta {
  readonly type: 'string'
  readonly default: string
  /** 1…256, default 256. The stored value is rejected above it. */
  readonly maxLength?: number
  readonly placeholder?: string
}

export interface NumberSettingDefinition extends SettingFieldMeta {
  readonly type: 'number'
  readonly default: number
  readonly min?: number
  readonly max?: number
  /** The input's step; presentation only. */
  readonly step?: number
  /** `true`: only safe integers are accepted. */
  readonly integer?: boolean
}

export interface SettingOption {
  readonly value: string
  /** Absent: the value itself. */
  readonly label?: string
}

export interface SelectSettingDefinition extends SettingFieldMeta {
  readonly type: 'select'
  /** Must be one of `options[].value`. */
  readonly default: string
  /** 1…64 options, each value 1…64 characters, unique. */
  readonly options: readonly SettingOption[]
}

export type ComponentSettingDefinition =
  | BooleanSettingDefinition
  | StringSettingDefinition
  | NumberSettingDefinition
  | SelectSettingDefinition

export type ComponentSettingValue = boolean | string | number

export type InferSettings<Schema extends ComponentSettingsSchema> = {
  -readonly [Key in keyof Schema]: Schema[Key] extends BooleanSettingDefinition
    ? boolean
    : Schema[Key] extends NumberSettingDefinition
      ? number
      : Schema[Key] extends StringSettingDefinition | SelectSettingDefinition
        ? string
        : never
}
```

`ComponentSettingsScope`, `ComponentSettingsDefinition`, `SettingsOf`, `ComponentRenderProps` and
`ComponentRegistrationHandle` keep their current shapes. A `select` is a `string` at the type level
on purpose: an implementation reads `settings.density` as a string and narrows it itself, which
keeps `InferSettings` free of literal-union inference from a `const` options array.

### Bounds the host enforces

The same numbers apply in `defineSettings()` (author-side, throws `ExtensionDefinitionError`) and in
`snapshotSettingsDefinition()` (host-side, rejects the definition), because the definition crosses a
package boundary and the host trusts nothing that crosses it.

| Bound | Value | Where it bites |
|---|---|---|
| Field key | 1…64 characters, ≤ 64 fields per implementation | unchanged from PR #50 |
| `label` / `description` | ≤ 128 / ≤ 256 characters | `defineSettings` throws above it; the host's snapshot **copies and clamps** rather than rejecting, so a long label never costs an implementation its settings |
| `string` value and `default` | ≤ `maxLength` ≤ 256 characters | write rejected as `invalid-settings` |
| `number` value and `default` | finite; safe integer when `integer`; within `min`…`max` when declared | write rejected as `invalid-settings` |
| `select` | 1…64 unique options, value 1…64 characters, `default` ∈ options | definition rejected when `default` is not an option |
| Stored map | ≤ 200 implementations, ≤ 64 fields each, ≤ 32 KiB serialized | contract refinement; the UI-state PUT body cap is 128 KiB (`UI_STATE_BODY_LIMIT`) |

### Persisted shape

Unchanged in structure — a sparse map of explicit overrides keyed by the exact implementation id,
in `~/.cezar/ui-state.json` (global) or `<repo>/.ai/cezar/ui-state.json` (project). Only the value
type widens:

```json
{
  "componentSettings": {
    "example.compact-header.row": {
      "showEngine": false,
      "density": "cozy",
      "titleMaxLength": 48,
      "statusPrefix": "•"
    }
  }
}
```

A field whose value equals its declared default is **not** written (canonicalization drops it), so
switching a setting back to its default removes the key and an implementation that changes its
default later picks the new one up. Files written by the boolean-only version parse unchanged.

## 📝 API Contracts

### Extension API additions

```ts
export function stringSetting(options: {
  readonly default: string
  readonly maxLength?: number
  readonly placeholder?: string
  readonly label?: string
  readonly description?: string
}): StringSettingDefinition

export function numberSetting(options: {
  readonly default: number
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly integer?: boolean
  readonly label?: string
  readonly description?: string
}): NumberSettingDefinition

export function selectSetting(options: {
  readonly default: string
  readonly options: readonly SettingOption[]
  readonly label?: string
  readonly description?: string
}): SelectSettingDefinition
```

`defineSettings()` keeps its signature and grows per-type validation and parsing: `parse()` still
accepts a sparse object, fills declared defaults, rejects unknown keys and now rejects a value of
the wrong type or outside its declared bounds. The package stays zero-runtime-dependency, node-free,
DOM-free and single-entry-point; Zod is neither imported nor exported.

### Registry (host-side, unchanged surface)

`getSettings`, `setSettings` and `resetSettings` keep their signatures and their error codes
(`invalid-settings`, `settings-unavailable`, `disposed`). Four internals change:

- `snapshotSettingsDefinition()` re-derives every descriptor type with its bounds, and **copies
  `label` and `description`** (clamped) — the section renders from the snapshot, so a dropped label
  would silently degrade every generated control to its humanized key.
- A definition the host cannot re-derive no longer costs the implementation. Today `prepare` throws
  `invalid-input` (`registry.ts:432`) and `provide` does not catch it, so an extension that declares
  a descriptor this cockpit does not know loses its component entirely. From this item `provide`
  registers the implementation **without settings** and records the issue through the existing
  diagnostic path; `register` (core) keeps throwing.
- `canonicalSettings(definition, parsed)` replaces `sparseSettings`: it checks each value against the
  **snapshotted** descriptor (type, length, range, option membership) and returns only the fields
  that differ from their default. An extension `parse()` that returns an out-of-bounds value fails
  here with `invalid-settings` and nothing is persisted.
- **The per-implementation read-modify-write becomes atomic.** `setSettings` currently reads the
  stored value outside the store's write queue (`registry.ts:371`) and then writes the whole entry,
  so two writes to different fields of one implementation started in the same tick both merge onto
  the same snapshot and the second erases the first. The store gains
  `update(target, componentId, merge)` — read, merge and write inside the queue — and `setSettings`
  and `resetSettings` go through it. This matters more after this item, not less: a card with four
  fields is exactly where two quick changes overlap.

### Contract schema

```ts
const componentSettingValueSchema = z.union([
  z.boolean(),
  z.string().max(256),
  z.number().finite(),
]);

export const componentSettingsSchema = z
  .record(
    z.string().min(1).max(128),
    z.record(z.string().min(1).max(64), componentSettingValueSchema)
      .refine((value) => Object.keys(value).length <= 64),
  )
  .refine((value) => Object.keys(value).length <= 200)
  .refine((value) => JSON.stringify(value).length <= 32 * 1024);
```

Both UI-state shapes keep `componentSettings` optional and both remain open bags, and
`setWorkspaceUiStateInputSchema` picks the widened record up through its existing `.shape` spread, so
one definition still covers both route families. `contract-parity` and `typed-bodies` tests cover
them as before; the widening is additive, so a stored file written by the current release still
parses.

### Store seam

```ts
export interface ComponentSettingsStore {
  get(target: ComponentSettingsTarget, componentId: ContributionId): Promise<JsonValue | undefined>
  set(target: ComponentSettingsTarget, componentId: ContributionId, value: JsonValue): Promise<void>
  /** NEW: read, merge and write one implementation's entry inside the write queue. */
  update(
    target: ComponentSettingsTarget,
    componentId: ContributionId,
    merge: (current: JsonValue | undefined) => JsonValue | undefined,
  ): Promise<void>
  clear(target: ComponentSettingsTarget, componentId: ContributionId): Promise<void>
  subscribe(listener: (target: ComponentSettingsTarget, componentId: ContributionId) => void): () => void
}
```

`merge` returning `undefined` clears the entry, which is what a canonical value equal to every
default produces. The store stays free of TanStack Query on purpose — `main.tsx:46` builds it before
the provider tree exists — so the **section**, which does live in the tree, invalidates
`queryKeys.uiState` and `workspaceQueryKeys.uiState` after a successful write. Concurrent reads of
one target share a single in-flight request.

## 📝 UI/UX

**Prototype:** `.ai/specs/assets/generic-component-settings-ui/` — illustrative statics, not a build.

![Proposed: Settings → Components with the generated controls](assets/generic-component-settings-ui/mockup-01-components-section.png)

*Proposed.* The section as it would render with two configurable implementations. Today the same
place looks like this — the project settings nav has no Components entry:
[current settings index](assets/generic-component-settings-ui/current-01-settings-index.png),
[current Agents section](assets/generic-component-settings-ui/current-02-settings-agents.png), whose
label/hint/control rhythm the generated rows follow.

![Proposed: rejected, unavailable and empty states, and the live reaction](assets/generic-component-settings-ui/mockup-02-states-and-reaction.png)

*Proposed.* Left to right: a rejected value (inline, nothing written), a card whose scope target is
unavailable (defaults, disabled), and the empty state. Below them, the DoD's third guarantee — the
header re-rendering after the setting changed, with no reload.

**Where.** Settings → Components, `/p/:projectId/settings/components`, between "Agent config" and
"Worktrees" in the project nav. Title "Components", description "Settings the installed component
implementations declare." The route always exists, so a pasted link lands on the empty state rather
than a 404; the **nav entry and the Settings index card are omitted** while no registration declares
settings (Q9), which on a stock cockpit is every time. `visibleSettingsSections(scope, capabilities,
{ omit })` stays a pure filter and the shell computes `omit` from the registry, re-reading it through
`registry.subscribe`/`revision` so activating an extension reveals the entry without a reload.

**The list.** One group per served contract, one card per configurable implementation inside it,
sorted by component id. A contract has no human name of its own (`ComponentContract` carries id,
version, capabilities and layout only), so the group heading comes from a host-owned display-name map
— the `agent-descriptors.ts` precedent — with the raw `id@version` in small monospace beside it and
as the fallback when a contract is not in the map. Each card shows the implementation's
`metadata.title`, its provider (the extension id, or "Cezar" for core), the component id in small
monospace, and a scope badge — **All projects** for a `global` definition, **This project** for a
`project` one — so the blast radius of a change is visible before it is made.

**The rows.** One per declared field, in schema order, in the label / one-line hint / control rhythm
the rest of Settings uses. The row is its own component rather than `SettingsField`: that chassis
renders an `<h2>` and requires a hint, which would nest a heading under the card title and invent
copy for a field that declares no `description`. It shares the same tokens and adds the
`<Label htmlFor>` the accessibility rule below promises.

| Descriptor | Control | Write |
|---|---|---|
| `boolean` | `Switch` | on change |
| `select` | `Select` with one item per option | on change |
| `string` | single-line `Input` (`placeholder` honored) | local, saved with the card's **Save** |
| `number` | `Input type="number"` (`min`/`max`/`step` honored) | local, saved with the card's **Save** |
| unknown `type` | disabled read-only row: "This setting needs a newer Cezar (`type`)" | never |

**Save** sits in the card footer beside **Restore defaults**, disabled until that card has an edited
and valid typed field — the shape Resources and Worktrees already use — and a row whose stored value
differs from its default shows a **Reset** action. Reset and Restore defaults write through
`registry.resetSettings(componentId, key?)`. The unknown-type row is reachable only once the host
snapshots a descriptor it cannot render (a later renderer item, or a field type added after this
one); until then an unrecognizable definition registers the implementation without settings.

**States.**

- *Loading* — the card's rows render skeletons while the first read of that implementation resolves.
- *Empty* — no implementation declares settings: `CenteredState` with "No component has settings to
  configure" and one line explaining that extensions add entries here.
- *Unavailable* — a read or write fails with `settings-unavailable` (UI state offline or read-only):
  the card's controls are disabled with the reason underneath, and the values shown are the declared
  defaults. Nothing else on the page is affected.
- *Rejected* — a typed value outside its declared bounds keeps **Save** disabled and shows the rule
  inline ("Must be 16–120"); no write is attempted. A write that the host still rejects
  (`invalid-settings`) leaves the stored value unchanged, keeps the edited value on screen and raises
  one `toast(..., { tone: 'danger' })`, as the other sections do.

**Accessibility.** Every control has a `<Label htmlFor>`; the hint and any error are wired through
`aria-describedby`, and the error row is a live region. The switch is the cockpit's own primitive, so
keyboard and screen-reader behavior match the rest of Settings. Reset is a real button, reachable in
tab order, labelled "Reset <field> to default".

**What the user sees end to end.** Activate an extension that declares settings and the Components
entry appears. Flip "Show engine" off on the compact task header, return to a task: the header
renders without the runner/model chip. No reload, no restart — the store write bumps the registry
revision and the host re-reads.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| No implementation declares settings | The nav entry and index card are omitted; a pasted URL still renders the empty state, and no UI-state request is made. |
| An implementation declares settings but is incompatible (`unknown-contract`, missing capability) | Not listed: it can never render, so its settings are moot. Its diagnostic stays the registry's. |
| A `project`-scoped definition on a page with no project | Unreachable by construction — the section only exists under `/p/:projectId/`. A project that disappears mid-edit fails the write as `settings-unavailable` and the card explains it. |
| A `global`-scoped definition edited from a project page | Written to workspace UI state; the badge says "All projects" before the change is made. |
| Stored value no longer matches the definition (renamed field, changed type) | The registry already reports one diagnostic and resolves to defaults; the form shows defaults and offers Restore defaults, which clears the stale entry. |
| Stored value out of the declared range after the author tightened `max` | Same path: the value is ignored for rendering, the field shows the default, and the next write canonicalizes the entry. |
| The user types a number outside `min`/`max` | The write is not attempted; the inline error names the rule. The previous persisted value is untouched. |
| The user clears a `string` field | An empty string is a legal value when `maxLength ≥ 0`; if it differs from the default it is stored, otherwise the key is dropped. |
| Two fields of one card are edited quickly | Each write is a sparse patch merged **inside the store's write queue** through `update()`, so the second sees the first. Without that change the merge happens on a snapshot read outside the queue and the second write erases the first field — the reason `update()` is in scope. |
| Two cockpit tabs edit different implementations | Unchanged from PR #50: read-modify-write plus the server's merge-write preserves both entries. |
| The same implementation is edited in two tabs | Last writer wins, as documented for UI state; the other tab reconciles on its next revision-driven read. |
| An extension is deactivated while its card is open | The registry change bumps the revision; the card disappears on the next render. Its stored entry stays and is reused if it is provided again. |
| An extension's `parse()` throws or returns a malformed value on write | `setSettings` rejects with `invalid-settings`; nothing is persisted and the section shows the error on the card. The extension is not unregistered. |
| An extension declares an unknown descriptor type (newer API than this cockpit) | The implementation registers **without settings** and the issue is recorded: the component keeps rendering and only its card is missing. That is a deliberate change from today, where `prepare` throws and `provide` does not catch, costing the extension its whole component. The read-only "needs a newer Cezar" row covers the narrower case of a type the host snapshots but cannot render. |
| UI state is offline, read-only or corrupt | Reads resolve to defaults with the existing single warning; writes reject as `settings-unavailable`. The rest of Settings and the cockpit keep working. |
| A settings write happens while a task is running | Nothing in the run path reads component settings; only the rendering implementation re-reads. |
| Another cockpit surface reads UI state right after a write | The section invalidates both UI-state query keys on success, so no reader keeps a stale snapshot. Sibling keys were never at risk: the server merges shallowly at the top level. |
| A setting is used to hold a token | Unchanged product rule: component settings are UI state, never a secret store. The README and the section's own copy say so; secrets belong in extension storage. |

## 📝 Risks & Impact Review

- **Public extension API growth.** Three helpers and four exported types are additive, but they are
  permanent: `@open-mercato/cezar-extension-api` is the only supported contract, so a descriptor
  shipped here is a shape the cockpit must keep reading. The bounds table is deliberately explicit
  for that reason. `test/surface.test.ts` must be edited in the same PR.
- **Protected UI-state shape.** `componentSettings` is listed in BACKWARD_COMPATIBILITY.md §2 as a
  boolean map bounded to 64 fields and 200 implementations. Widening the value type is additive for
  readers (old files parse) but not for *writers*: a cockpit that writes a string against a server
  built before this change is rejected with 400. That pairing only occurs if a bundle is served by a
  different build than the one it shipped with, which the cockpit's build does not do; the paragraph
  is updated in the same PR so the protected shape and the code agree.
- **Host-side re-validation is the security boundary.** The definition is extension code. Every new
  bound must exist in `snapshotSettingsDefinition` and `canonicalSettings`, not only in
  `defineSettings` — an author-side-only check is bypassed by an extension that constructs the
  definition object literally.
- **Relaxing the definition check is a deliberate behavior change.** An extension's bad settings
  definition stops failing its registration and starts registering the implementation without
  settings. It makes a newer extension forward-compatible with an older cockpit, and it means a
  typo in a schema now shows up as a missing card plus one diagnostic line rather than a missing
  component. Core keeps the strict path, so a core mistake still fails the gate.
- **A dead nav entry avoided, a new visibility rule accepted.** The section's entry is computed from
  the registry rather than declared statically, which is one more thing the shell re-reads on a
  registry revision. The alternative — an always-visible section that is empty for every user who
  installs no extension — was judged worse; the filter stays pure and testable.
- **Read amplification.** The section reads one value per configurable implementation, and the
  persistent store fetches UI state per read (`settings.ts:43`), so N implementations mean N GETs per
  revision bump — including the bump the section's own write causes. Mitigations in scope:
  concurrent reads of one target share a single in-flight request, and the card renders from its own
  edited value rather than re-fetching after its own write. Routing the store through the cockpit's
  TanStack queries would be the structural fix, but the store is built in `main.tsx` before the
  provider tree exists; the section invalidates those query keys instead, and moving the store behind
  the query client stays a follow-on.
- **Coordination with the override picker (PR #58).** Both want a `components` section. Whichever
  lands second mounts into the existing one and does not add a second `SettingsSectionId`; the
  generated form is a standalone component precisely so it can be dropped into a card.
- **Zero config.** Nothing is required of the user: no config key, no flag, and no request when no
  implementation declares settings. The section is discovered from the registry, like every other
  capability in this repo.
- **Rollback.** Reverting this item leaves the widened values in `ui-state.json` as entries the
  boolean-only schema would reject on the next write of that map — the affected implementation's
  entry must be cleared, which `resetSettings` already does and which the older code path does on a
  malformed entry. No task or runner state is involved.
- **Not covered here.** A custom renderer API, layered global-defaults-plus-project-override scopes,
  settings search, and import/export of a settings profile. Each is a separate item and none is
  blocked by this design.

## 📋 Phasing

1. **Phase 1 — The vocabulary.** The three descriptors, their helpers, `InferSettings`, the
   host-side re-derivation and canonicalization, and the change that keeps an unrecognizable
   definition from costing an extension its component. Provable entirely in unit tests; nothing
   renders yet, and a boolean-only implementation behaves identically.
2. **Phase 2 — Persistence.** The widened contract schema, the store's value guard, its atomic
   per-implementation `update()` and read deduplication, plus the UI-state route tests. After this
   phase a widened value survives a reload and two quick edits of one card cannot drop each other.
3. **Phase 3 — The section.** The renderer table, the Components section, the registry entry and
   every state (loading, empty, unavailable, rejected). After this phase a user can change a value.
4. **Phase 4 — The worked example and the docs.** The example's settings, the end-to-end cockpit
   proof, and the README/AGENTS/BACKWARD_COMPATIBILITY updates.

Each phase leaves the application working and shippable on its own. Phase 3 is the one that is
independently *useful* — it renders today's boolean settings without phases 1–2 — which is why it is
also the split line if the owner would rather ship this as two items (Q8).

## 📋 Implementation Plan

Every step keeps `npm run typecheck`, `npm test`, `npm run test:unit`, `npm run build` and
`npm run test:package` green. For every regression guard below, prove it fails without the change
(`git stash push -- <source files>`, run the test, confirm red, restore) — the repo's rule, and the
only way to know a new test is not green either way.

### Phase 1 — The vocabulary

1. **Add the descriptors and helpers.**
   - Code: `packages/extension-api/src/components.ts`, `src/index.ts`, `test/surface.test.ts`.
   - Test: `defineSettings` with one field of each type infers `{ a: boolean; b: string; c: number; d: string }`;
     a `select` whose `default` is not an option throws; a `string` default above `maxLength` throws;
     a non-finite or non-integer number throws when `integer` is set; an implementation that declares
     only `booleanSetting` still type-checks and parses identically.
2. **Teach `parse()` the new types.**
   - Code: the parser inside `defineSettings`.
   - Test: a sparse object fills defaults per type; an unknown key still throws; a wrong-typed value
     throws naming the field; a string over `maxLength`, a number outside `min`/`max` and a select
     value outside `options` each throw.
3. **Re-derive and canonicalize host-side.**
   - Code: `snapshotSettingsDefinition` and `canonicalSettings` in
     `packages/web/src/component-registry/registry.ts`.
   - Test: a hand-built definition object (not from `defineSettings`) with an over-long string
     default is rejected; a `parse()` that returns an out-of-bounds value makes `setSettings` reject
     with `invalid-settings` and persists nothing; a value equal to its default is dropped from the
     canonical override for every type; a declared `label`/`description` survives the snapshot and
     reaches `registration.settings.schema` (the section renders from it), with an over-long one
     clamped rather than rejected.
4. **Stop a bad definition from costing the component.**
   - Code: `provide` in `registry.ts` records the issue and registers without settings; `register`
     (core) keeps throwing.
   - Test: an extension whose definition the host cannot re-derive still has a rendering component
     and no settings card, and one diagnostic is reported; core's `register` still throws
     `invalid-input`; prove the test fails against today's `prepare`-throws behavior.

### Phase 2 — Persistence

5. **Widen the contract schema.**
   - Code: `packages/contract/src/workspace.ts`.
   - Test: an old boolean-only fixture parses; mixed boolean/string/number entries parse; a
     257-character string, a 65-field entry, a 201-entry map and a >32 KiB map each fail;
     contract-parity and typed-body suites stay green for both UI-state route families.
6. **Widen the store, add the atomic `update()`, deduplicate reads.**
   - Code: `packages/web/src/component-registry/settings.ts`, and `setSettings`/`resetSettings` in
     `registry.ts` routed through `update()`.
   - Test: a string/number map round-trips through both scope targets; a non-scalar value is
     rejected as `invalid-settings`; **two `setSettings` calls for different fields of one
     implementation started in the same tick both persist** (prove it fails against today's
     read-outside-the-queue merge); two concurrent `get`s of one target issue one HTTP read; a
     project change mid-operation still fails as `settings-unavailable`.
7. **Prove reload persistence for the new types.**
   - Test: write one global and one project value of each type, dispose the store, recreate it and
     read both back — the settings-API item's Definition-of-Done test, extended past booleans.

### Phase 3 — The section

8. **Build the renderer table.**
   - Code: `packages/web/src/routes/settings/component-settings-field.tsx`.
   - Test: each descriptor renders its control with label, hint and current value; a missing `label`
     humanizes the key; an unknown type renders the disabled read-only row; a value differing from
     the default shows Reset.
9. **Build the section.**
   - Code: `packages/web/src/routes/settings/component-settings-section.tsx`, discovery through
     `listComponentChoices(registry, contract)` (never a hand-composed `list`/`listUsable`), the
     contract display-name map, and the `SETTINGS_SECTIONS` entry in `routes/settings/registry.tsx`.
   - Test: only compatible registrations with a definition are listed, grouped by contract and sorted
     by component id; an incompatible registration with settings is excluded; the scope badge follows
     the definition; the group heading uses the display name and falls back to `id@version`; the
     empty state renders with no implementation; the route answers at
     `/p/<projectId>/settings/components`.
10. **Show the entry only when something is configurable.**
   - Code: the `omit` argument on `visibleSettingsSections` and the shell's registry-driven
     computation of it (`useSyncExternalStore(registry.subscribe, registry.revision)`).
   - Test: with no configurable implementation the nav and the index card omit Components while the
     route still renders; registering one reveals the entry without a remount; the filter stays pure
     (a unit test calls it with an explicit `omit`).
11. **Wire writes, resets and failures.**
   - Test: a switch and a select write `{ key: value }` through `setSettings` on change; a text or
     number field writes only when Save is pressed, and Save is disabled until the card is dirty and
     valid; an out-of-range number shows the inline rule and issues no write; a successful write
     invalidates both UI-state query keys; `settings-unavailable` disables the card with its reason;
     Reset and Restore defaults call `resetSettings` with and without a key; a failed write leaves
     the previous value visible.

### Phase 4 — The worked example and the docs

12. **Give the example settings.**
    - Code: `packages/extension-api/examples/compact-task-header/index.ts` declares `showEngine`
      (boolean), `density` (select: compact/cozy), `titleMaxLength` (number, 16–120, integer) and
      `statusPrefix` (string, ≤ 8) and renders from them.
    - Test: `packages/extension-api/test/compact-task-header.test.ts` asserts the declared schema and
      that the component reads it; the example still imports only itself, the package and `react`
      (`test/boundary.test.ts`).
13. **Prove the Definition of Done end to end.**
    - Test: a cockpit test activates the example through the real extension host, renders the
      Components section and the task header together, changes `showEngine` and `density`, and
      asserts the store received the canonical override **and** the header re-rendered with the new
      value; a second case asserts core's default is unaffected.
14. **Document the durable contract.**
    - Docs: the settings paragraph in `packages/extension-api/README.md` (the four field types, the
      generated form, the non-secret rule), the component-settings row in `AGENTS.md` (the section,
      the host-side bounds, the renderer table as the seam a custom renderer would attach to), the
      `componentSettings` paragraph in `BACKWARD_COMPATIBILITY.md` §2 (the widened value union and
      its caps), and the release notes.
15. **Run the full gate.** The five configured commands, plus the focused extension-api,
    component-registry, component-host, settings-section and UI-state suites. Manual verification
    (optional, documented in the PR): add the example to `BUILTIN_EXTENSIONS` locally and run
    `CEZ_DRY_RUN=1 npm run dev` to click the flow end to end.
