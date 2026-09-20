import type { Commands } from './commands.ts'
import type { ComponentRegistry } from './components.ts'
import type { Events } from './events.ts'
import type { Disposable } from './lifecycle.ts'
import type { ExtensionManifest } from './manifest.ts'
import type { Notifications } from './notifications.ts'
import type { ExtensionPermission } from './permissions.ts'
import type { ExtensionStorage } from './storage.ts'

/**
 * Everything an extension can reach, handed to its `activate`. The host implements it; an
 * extension never constructs one.
 *
 * Lifecycle the host guarantees:
 * - `activate` is awaited once per activation, limited by the host's timeout. Each activation gets
 *   a new context.
 * - Everything registered through the context is tracked and disposed automatically on
 *   deactivation — after `deactivate()` settles (or exceeds the host's timeout): `subscriptions`
 *   first, then the registrations, each in reverse order. Each registration also returns a
 *   {@link Disposable} for removing it early; `dispose()` is idempotent.
 * - Any context call after deactivation rejects or throws with code `disposed`.
 * - Every service is present. Protected calls throw, or reject when they return a promise, with
 *   `permission-denied` when the activation lacks the relevant permission. `commands.has` answers
 *   `false` for a command the caller may not execute. Liveness is checked first, so `disposed`
 *   wins after deactivation.
 * - Closing or reloading the page does not deactivate anything.
 */
export interface ExtensionContext {
  /** The manifest as the host loaded it. */
  readonly extension: Readonly<ExtensionManifest>
  /** The requested, supported and approved permissions this activation runs with. Frozen. */
  readonly permissions: readonly ExtensionPermission[]
  /** Disposed by the host after `deactivate`. For the extension's own resources (timers, DOM listeners). */
  readonly subscriptions: Disposable[]
  readonly commands: Commands
  readonly events: Events
  readonly storage: ExtensionStorage
  readonly components: ComponentRegistry
  readonly notifications: Notifications
}
