/**
 * An extension's id: `publisher.name` — two dot-separated segments of `[a-z0-9][a-z0-9-]*`,
 * at most 64 characters, e.g. `acme.compact-tasks`.
 *
 * The `cezar` publisher is reserved for core. The grammar accepts it (core's own ids are written
 * with it); the host refuses to load a third-party extension that claims it.
 */
export type ExtensionId = string

/**
 * The id of anything an extension creates — a command, an event, a component implementation:
 * two or more dot-separated segments of `[a-z0-9][a-z0-9-]*`, at most 128 characters, e.g.
 * `acme.tasks.open-next`.
 *
 * An extension may only create ids under its own `${extension.id}.` prefix. That ownership rule
 * is enforced by the host at registration, because only the host knows which extension is
 * calling; the helpers here check the grammar alone.
 */
export type ContributionId = string

const SEGMENT = '[a-z0-9][a-z0-9-]*'
const EXTENSION_ID = new RegExp(`^${SEGMENT}\\.${SEGMENT}$`)
const CONTRIBUTION_ID = new RegExp(`^${SEGMENT}(?:\\.${SEGMENT})+$`)

const MAX_EXTENSION_ID_LENGTH = 64
const MAX_CONTRIBUTION_ID_LENGTH = 128

/** `true` when `id` is a well-formed {@link ExtensionId}. Never throws, whatever it is given. */
export function isValidExtensionId(id: string): boolean {
  return typeof id === 'string' && id.length <= MAX_EXTENSION_ID_LENGTH && EXTENSION_ID.test(id)
}

/** `true` when `id` is a well-formed {@link ContributionId}. Never throws, whatever it is given. */
export function isValidContributionId(id: string): boolean {
  return typeof id === 'string' && id.length <= MAX_CONTRIBUTION_ID_LENGTH && CONTRIBUTION_ID.test(id)
}
