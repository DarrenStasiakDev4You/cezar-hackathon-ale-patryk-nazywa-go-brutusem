import type { ComponentType } from 'react'

import type { ContributionId } from './ids.ts'
import type { Disposable } from './lifecycle.ts'
import type { ManifestIssue } from './manifest.ts'
import { ExtensionDefinitionError } from './errors.ts'
import { createToken } from './tokens.ts'

/**
 * A named behaviour of a contract that its props' types cannot prove, e.g. `restores-draft` or
 * `task.continue`. The contract's TSDoc defines each one. One or more dot-separated segments of
 * `[a-z0-9][a-z0-9-]*`, at most 64 characters, and local to its contract.
 *
 * An implementation *declares* the capabilities it honours; `checkComponentCompatibility`
 * compares declarations and cannot prove the behaviour.
 */
export type ComponentCapability = string

/**
 * The box the host gives every implementation of a contract. Advisory data: the host applies it
 * to the slot, and the implementation is written for it. Responsive rules (breakpoints) stay the
 * host's.
 */
export interface ComponentLayout {
  /** `content` (default): the implementation's own block size. `fill`: the slot grows into the
   *  remaining space of its container, and the implementation must stretch to it. */
  readonly sizing?: 'content' | 'fill'
  /** The edge the host pins the slot to while its container scrolls. */
  readonly sticky?: 'top' | 'bottom'
  /** CSS pixels the host reserves while an implementation loads, fails or is swapped, so the
   *  page does not shift. An integer from 0 to 2048. */
  readonly minBlockSize?: number
}

/** What a contract declares beside its id: {@link defineComponentContract}'s second argument. */
export interface ComponentContractOptions {
  /**
    * Major version of the functional contract, written `id@version` (`task.header@1`). It is
   * part of the public API. Bump it when a change can break an existing implementation: remove,
   * rename or narrow a prop; make an optional prop required or add a required one; change when a
   * callback is called or what it promises; add a required capability or promote an optional one;
   * change `layout.sizing`. Adding an optional prop, adding or removing an optional capability,
   * demoting a required capability, changing `sticky` or `minBlockSize`, or clarifying TSDoc does
   * not bump it.
   */
  readonly version: number
  /** Behaviours every implementation must declare. Unique. Default `[]`. */
  readonly requiredCapabilities?: readonly ComponentCapability[]
  /** Behaviours an implementation may declare. The host relies on one only for an implementation
   *  that declares it; for the others it must not depend on that behaviour (e.g. it hides the
   *  feature). Unique, and none may also be required. Default `[]`. */
  readonly optionalCapabilities?: readonly ComponentCapability[]
  /** The box the host gives every implementation. Omitted: the host decides alone. */
  readonly layout?: ComponentLayout
}

/**
 * A replaceable component, declared by core: its id, the major `version` of its functional
 * contract, the capabilities an implementation declares, the box the host renders it in, and — as
 * types — its props. The props are the typed half of the contract: every prop, data and callbacks
 * alike, and the TSDoc on each prop states the behaviour an implementation must honour (e.g. "call
 * `onOpen(runId)` when the user activates a row"). Capabilities name the behaviours types cannot
 * prove.
 */
export interface ComponentContract<Props> {
  readonly kind: 'component'
  readonly id: ContributionId
  /** Major version of the functional contract. See {@link ComponentContractOptions.version}. */
  readonly version: number
  /** Behaviours every implementation must declare. Always set by the helper (`[]` when none);
   *  optional in the type so a structurally built token, or one from an older copy of this
   *  package, still fits. Readers treat a missing list as `[]`. */
  readonly requiredCapabilities?: readonly ComponentCapability[]
  /** Behaviours an implementation may declare; the host relies on one only for an implementation
   *  that declares it. Always set by the helper, and read like `requiredCapabilities`. */
  readonly optionalCapabilities?: readonly ComponentCapability[]
  /** The box the host gives every implementation; absent when the contract declares none. */
  readonly layout?: ComponentLayout
  /** Type-only phantom, as on `CommandToken`. */
  readonly __props?: (props: Props) => Props
}

const CAPABILITY = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/
const MAX_CAPABILITY_LENGTH = 64
const MAX_CAPABILITIES = 32
const CAPABILITY_RULE = 'must be one or more dot-separated segments of [a-z0-9][a-z0-9-]*, at most 64 characters'

const SIZING: readonly unknown[] = ['content', 'fill']
const STICKY: readonly unknown[] = ['top', 'bottom']
const MAX_MIN_BLOCK_SIZE = 2048
const LAYOUT_KEYS: readonly string[] = ['sizing', 'sticky', 'minBlockSize']

/**
 * Declares a component contract:
 * `defineComponentContract<TaskListProps>('cezar.tasks.list', { version: 1, requiredCapabilities: ['opens-run'] })`.
 *
 * Throws {@link ExtensionDefinitionError} (code `invalid-id`, with every issue) when the id is not a
 * {@link ContributionId}, `version` is not a positive integer, a capability list is not an array of
 * unique well-formed {@link ComponentCapability} names, an optional capability is also required,
 * the two lists hold more than 32 names together, or `layout` has an unknown key or a value outside
 * its type. Returns a deeply frozen `{ kind, id, version, requiredCapabilities, optionalCapabilities,
 * layout? }`; both lists are `[]` when not given.
 */
export function defineComponentContract<Props>(
  id: ContributionId,
  options: ComponentContractOptions,
): ComponentContract<Props> {
  const given = (options ?? {}) as Partial<Record<keyof ComponentContractOptions, unknown>>
  const issues: ManifestIssue[] = []
  const issue = (path: string, message: string): void => {
    issues.push({ path, message })
  }

  const version = given.version
  if (!(typeof version === 'number' && Number.isInteger(version) && version >= 1)) {
    issue('version', 'must be a positive integer — the major version of the contract')
  }
  const required = capabilityList(given.requiredCapabilities, 'requiredCapabilities', issue)
  const optional = capabilityList(given.optionalCapabilities, 'optionalCapabilities', issue)
  for (const [capability, index] of optional) {
    const requiredIndex = required.get(capability)
    if (requiredIndex !== undefined) {
      issue(`optionalCapabilities[${index}]`, `must not also be required — it is requiredCapabilities[${requiredIndex}]`)
    }
  }
  const count = required.size + optional.size
  if (count > MAX_CAPABILITIES) {
    issue(
      '',
      `requiredCapabilities and optionalCapabilities must hold at most ${MAX_CAPABILITIES} names together (got ${count})`,
    )
  }
  const layout = given.layout === undefined ? undefined : layoutOf(given.layout, issue)

  return createToken<ComponentContract<Props>>(
    {
      kind: 'component',
      id,
      version: version as number,
      requiredCapabilities: Object.freeze([...required.keys()]),
      optionalCapabilities: Object.freeze([...optional.keys()]),
      ...(layout === undefined ? {} : { layout: Object.freeze(layout) }),
    },
    issues,
  )
}

/**
 * A capability list's well-formed, unique names, each mapped to its index in the author's list so
 * an issue names the exact entry. Every broken rule becomes an issue; a list longer than the cap is
 * one issue and is not read further.
 */
function capabilityList(
  value: unknown,
  path: string,
  issue: (path: string, message: string) => void,
): Map<ComponentCapability, number> {
  const names = new Map<ComponentCapability, number>()
  if (value === undefined) return names
  if (!Array.isArray(value)) {
    issue(path, 'must be an array of capability names')
    return names
  }
  if (value.length > MAX_CAPABILITIES) {
    issue(path, `must hold at most ${MAX_CAPABILITIES} names`)
    return names
  }
  for (let index = 0; index < value.length; index += 1) {
    const name: unknown = value[index]
    if (typeof name !== 'string' || name.length > MAX_CAPABILITY_LENGTH || !CAPABILITY.test(name)) {
      issue(`${path}[${index}]`, CAPABILITY_RULE)
      continue
    }
    const first = names.get(name)
    if (first !== undefined) {
      issue(`${path}[${index}]`, `must be unique — it repeats ${path}[${first}]`)
      continue
    }
    names.set(name, index)
  }
  return names
}

/** A copy of the known layout fields; an unknown key or a value outside its type becomes an issue. */
function layoutOf(value: unknown, issue: (path: string, message: string) => void): ComponentLayout {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issue('layout', 'must be an object')
    return {}
  }
  const fields = value as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!LAYOUT_KEYS.includes(key)) issue(`layout.${key}`, `is not a layout field (${LAYOUT_KEYS.join(', ')})`)
  }
  const layout: { -readonly [K in keyof ComponentLayout]: ComponentLayout[K] } = {}
  const { sizing, sticky, minBlockSize } = fields
  if (sizing !== undefined) {
    if (SIZING.includes(sizing)) layout.sizing = sizing as ComponentLayout['sizing']
    else issue('layout.sizing', "must be 'content' or 'fill'")
  }
  if (sticky !== undefined) {
    if (STICKY.includes(sticky)) layout.sticky = sticky as ComponentLayout['sticky']
    else issue('layout.sticky', "must be 'top' or 'bottom'")
  }
  if (minBlockSize !== undefined) {
    if (
      typeof minBlockSize === 'number' &&
      Number.isInteger(minBlockSize) &&
      minBlockSize >= 0 &&
      minBlockSize <= MAX_MIN_BLOCK_SIZE
    ) {
      layout.minBlockSize = minBlockSize
    } else {
      issue('layout.minBlockSize', `must be an integer from 0 to ${MAX_MIN_BLOCK_SIZE}`)
    }
  }
  return layout
}

/** The props of a contract: `ComponentProps<typeof TaskList>`. */
export type ComponentProps<C> = C extends ComponentContract<infer P> ? P : never

export type ComponentSettingsScope = 'global' | 'project'
export interface BooleanSettingDefinition { readonly type: 'boolean'; readonly default: boolean }
export type ComponentSettingDefinition = BooleanSettingDefinition
export type ComponentSettingsSchema = Readonly<Record<string, ComponentSettingDefinition>>
export type InferSettings<Schema extends ComponentSettingsSchema> = {
  -readonly [Key in keyof Schema]: Schema[Key] extends BooleanSettingDefinition ? boolean : never
}
export interface ComponentSettingsDefinition<Settings> {
  readonly scope: ComponentSettingsScope
  readonly schema: ComponentSettingsSchema
  readonly defaults: Settings
  readonly parse: (input: unknown) => Settings
}
export type SettingsOf<Definition> = Definition extends ComponentSettingsDefinition<infer Settings> ? Settings : never
export type ComponentRenderProps<Props, Settings = never> = [Settings] extends [never]
  ? Props
  : Props & { readonly useComponentSettings: () => Settings }

export function booleanSetting(options: { readonly default: boolean }): BooleanSettingDefinition {
  if (typeof options?.default !== 'boolean') throw settingsError('Invalid component settings default')
  return Object.freeze({ type: 'boolean' as const, default: options.default })
}

export function defineSettings<const Schema extends ComponentSettingsSchema>(options: {
  readonly scope: ComponentSettingsScope
  readonly schema: Schema
}): ComponentSettingsDefinition<InferSettings<Schema>> {
  if (options?.scope !== 'global' && options?.scope !== 'project') throw settingsError('Invalid component settings scope')
  if (typeof options?.schema !== 'object' || options.schema === null || Array.isArray(options.schema)) {
    throw settingsError('Invalid component settings schema')
  }
  const fields: Record<string, BooleanSettingDefinition> = {}
  for (const key of Object.keys(options.schema)) {
    const descriptor = (options.schema as Record<string, unknown>)[key]
    if (key.length === 0 || key.length > 64 || typeof descriptor !== 'object' || descriptor === null ||
      (descriptor as { type?: unknown }).type !== 'boolean' || typeof (descriptor as { default?: unknown }).default !== 'boolean') {
      throw settingsError(`Invalid component setting "${key}"`)
    }
    fields[key] = Object.freeze({ type: 'boolean', default: (descriptor as BooleanSettingDefinition).default })
  }
  if (Object.keys(fields).length > 64) throw settingsError('Component settings have too many fields')
  const schema = Object.freeze({ ...fields }) as Schema
  const defaults = Object.freeze(Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.default]))) as InferSettings<Schema>
  const parse = (input: unknown): InferSettings<Schema> => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('component settings must be an object')
    const source = input as Record<string, unknown>
    for (const key of Object.keys(source)) if (!Object.prototype.hasOwnProperty.call(fields, key)) throw new TypeError(`unknown component setting "${key}"`)
    const result: Record<string, boolean> = {}
    for (const [key, descriptor] of Object.entries(fields)) {
      const value = source[key]
      if (value === undefined) result[key] = descriptor.default
      else if (typeof value !== 'boolean') throw new TypeError(`component setting "${key}" must be a boolean`)
      else result[key] = value
    }
    return Object.freeze(result) as InferSettings<Schema>
  }
  return Object.freeze({ scope: options.scope, schema, defaults, parse })
}

function settingsError(message: string): ExtensionDefinitionError {
  return new ExtensionDefinitionError('invalid-id', message, [{ path: 'settings', message }])
}

/**
 * One implementation of a contract. Core's default and an extension's replacement have the same
 * shape; only the id prefix differs.
 */
export interface ComponentImplementation<Props, Settings = never> {
  /** Core: `cezar.…` (e.g. `cezar.task.header.default`); an extension: under its own id, e.g.
   *  `acme.compact-tasks.dense`. */
  readonly id: ContributionId
  /** Shown to the user when they choose an implementation. */
  readonly title: string
  readonly description?: string
  /**
   * The capabilities this implementation declares it honours. Must include every one its
   * contract requires, may include any of its optional ones; other names are kept as custom
   * capabilities and never affect the fit. A declaration, not a proof:
   * `checkComponentCompatibility` compares it with the contract, and the host relies on it.
   */
  readonly capabilities?: readonly ComponentCapability[]
  readonly settings?: ComponentSettingsDefinition<Settings>
  readonly component: ComponentType<ComponentRenderProps<Props, Settings>>
}

/**
 * Where extensions offer alternative implementations of core components. Host semantics:
 * - **Opt-in selection.** `provide` only makes an implementation available; the user selects one
 *   per contract. Core's default implementation is always listed.
 * - **Guaranteed fallback.** A replacement that throws while rendering falls back to core's
 *   default, with a visible notice.
 * - **Versioned.** An implementation is bound to the `version` of the token it was compiled
 *   against; a host whose contract has moved to another major ignores it with a
 *   `contract-version-mismatch` diagnostic instead of rendering it with the wrong props.
 * - **The author's own mistakes throw.** `provide` throws `disposed`, `invalid-id` (a token that
 *   is not `{ kind: 'component', id, version }`, or a malformed implementation id),
 *   `namespace-violation` (an id outside `${extension.id}.`), `duplicate-registration` (an id
 *   already provided) and `invalid-input` (an implementation field of the wrong type).
 * - **A misfit is kept, never thrown.** An implementation that does not fit (another major, a
 *   missing required capability, or a contract this Cezar does not serve) is kept but never
 *   rendered, and is reported as a diagnostic.
 */
export interface ComponentRegistry {
  /** `NoInfer`: P comes from the contract only, so an implementation with other props is rejected. */
  provide<P, Settings>(contract: ComponentContract<P>, implementation: ComponentImplementation<NoInfer<P>, Settings>): ComponentRegistrationHandle<Settings>
}

export interface ComponentRegistrationHandle<Settings> extends Disposable {
  readonly componentId: ContributionId
  getSettings(): Promise<Settings | undefined>
  onSettingsChange(listener: (settings: Settings | undefined) => void): Disposable
}
