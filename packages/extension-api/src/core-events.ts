import { defineEvent } from './events.ts'

/**
 * Core's public events — the `cezar.*` tokens the cockpit emits and any extension may listen to
 * through `context.events`. Only core emits them: an extension's `emit` of a `cezar.*` id throws
 * `namespace-violation`, whatever the extension's own id.
 *
 * The payloads are narrow view models declared here — ids and versions, never a prompt, a title or
 * a path — because this package never imports the contract (`test/boundary.test.ts`). A core token
 * lands here in the same PR as the host code that emits it.
 */

/** An extension that has just become active. */
export interface ExtensionActivation {
  readonly extensionId: string
  /** The manifest's `version`. */
  readonly version: string
}

/**
 * An extension became `active`. Emitted after its own listeners are live, so an extension that
 * subscribes in `activate` also hears its own activation. Not replayed: an extension activated
 * later does not hear the earlier ones.
 */
export const ExtensionActivated = defineEvent<ExtensionActivation>('cezar.extension.activated')
