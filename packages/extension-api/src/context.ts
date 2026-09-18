import type { Commands } from './commands.ts'
import type { Events } from './events.ts'
import type { Disposable } from './lifecycle.ts'
import type { ExtensionManifest } from './manifest.ts'

/**
 * Everything an extension can reach, handed to its `activate`. The host implements it; an
 * extension never constructs one.
 *
 * Lifecycle the host guarantees:
 * - `activate` is awaited once.
 * - Everything registered through the context is tracked and disposed automatically on
 *   deactivation — in reverse order, after `deactivate()` resolves. Each registration also
 *   returns a {@link Disposable} for removing it early; `dispose()` is idempotent.
 * - Any context call after deactivation rejects or throws with code `disposed`.
 */
export interface ExtensionContext {
  /** The manifest as the host loaded it. */
  readonly extension: Readonly<ExtensionManifest>
  /** Disposed by the host after `deactivate`. For the extension's own resources (timers, DOM listeners). */
  readonly subscriptions: Disposable[]
  readonly commands: Commands
  readonly events: Events
}
