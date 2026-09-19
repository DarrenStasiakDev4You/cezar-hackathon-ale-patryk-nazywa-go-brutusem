import type {
  ExtensionPermission,
  ExtensionManifest,
} from '@open-mercato/cezar-extension-api'
import { isValidContributionId } from '@open-mercato/cezar-extension-api'

import type { ExtensionScope, ExtensionServices } from './registry'

/** The permissions this host understands. `network` is reserved but deliberately not enforceable. */
export const STANDARD_PERMISSIONS: Record<ExtensionPermission, { readonly reserved: boolean }> = Object.freeze({
  'ui.components': { reserved: false },
  'commands.execute': { reserved: false },
  storage: { reserved: false },
  events: { reserved: false },
  network: { reserved: true },
  notifications: { reserved: false },
})

export type PermissionCheck = {
  readonly code: 'unsupported-permission' | 'permission-not-granted'
  readonly message: string
}

/** Checks the requested set without running extension code. */
export function checkPermissions(manifest: Readonly<ExtensionManifest>, granted: readonly string[]): PermissionCheck | null {
  const requested = manifest.permissions ?? []
  const unsupported = requested.filter((permission) => !Object.hasOwn(STANDARD_PERMISSIONS, permission))
  if (unsupported.length > 0) {
    return {
      code: 'unsupported-permission',
      message: `Extension "${manifest.id}" is incompatible with this Cezar. Unknown or unsupported permission: ${unsupported.join(', ')}.`,
    }
  }

  const approved = new Set(granted)
  const missing = requested.filter((permission) => !approved.has(permission))
  if (missing.length > 0) {
    return {
      code: 'permission-not-granted',
      message: `Extension "${manifest.id}" requests permissions that have not been approved: ${missing.join(', ')}.`,
    }
  }
  return null
}

/** Host policy for compiled-in extensions: grant the supported names they request. */
export function builtinGrant(manifest: Readonly<ExtensionManifest>): readonly ExtensionPermission[] {
  return Object.freeze(
    (manifest.permissions ?? []).filter((permission): permission is ExtensionPermission =>
      Object.hasOwn(STANDARD_PERMISSIONS, permission),
    ),
  )
}

/** Error raised by a guarded service. Its fields are intentionally duck-typed across package copies. */
export function permissionDeniedError(
  extensionId: string,
  permission: ExtensionPermission,
  api: string,
): Error & { readonly code: 'permission-denied'; readonly permission: ExtensionPermission; readonly api: string } {
  return Object.assign(
    new Error(
      `Extension "${extensionId}" called context.${api}() without the "${permission}" permission. Add "${permission}" to "permissions" in its manifest.`,
    ),
    { code: 'permission-denied' as const, permission, api },
  )
}

/**
 * Places one permission boundary in front of the service factory. The explicit shape is
 * intentional: a new ExtensionServices member must be considered here before it can reach an
 * extension.
 */
export function guardServices(
  scope: ExtensionScope,
  services: ExtensionServices,
  effective: ReadonlySet<ExtensionPermission>,
): ExtensionServices {
  const denied = (permission: ExtensionPermission, api: string): never => {
    scope.assertLive()
    throw permissionDeniedError(scope.extension.id, permission, api)
  }
  const rejected = (permission: ExtensionPermission, api: string) => async (..._args: unknown[]): Promise<never> =>
    denied(permission, api)

  const commands = Object.freeze({
    register: (...args: unknown[]) => {
      scope.assertLive()
      return services.commands.register(
        args[0] as never,
        args[1] as never,
        args[2] as never,
      )
    },
    async execute(...args: unknown[]) {
      scope.assertLive()
      const command = args[0]
      if (!effective.has('commands.execute') && !isOwnCommand(scope.extension.id, command)) {
        return denied('commands.execute', 'commands.execute')
      }
      return services.commands.execute(command as never, ...(args.slice(1) as never[]))
    },
    has(command: unknown) {
      scope.assertLive()
      if (!effective.has('commands.execute') && !isOwnCommand(scope.extension.id, command)) return false
      return services.commands.has(command as never)
    },
  })

  const events = effective.has('events')
    ? services.events
    : ({
        on: (..._args: unknown[]) => denied('events', 'events.on'),
        once: (..._args: unknown[]) => denied('events', 'events.once'),
        off: (..._args: unknown[]) => denied('events', 'events.off'),
        emit: (..._args: unknown[]) => denied('events', 'events.emit'),
      } as unknown as ExtensionServices['events'])

  const storage = effective.has('storage')
    ? services.storage
    : ({
        get: rejected('storage', 'storage.get'),
        set: rejected('storage', 'storage.set'),
        delete: rejected('storage', 'storage.delete'),
        keys: rejected('storage', 'storage.keys'),
      } as unknown as ExtensionServices['storage'])

  const components = effective.has('ui.components')
    ? services.components
    : ({ provide: (..._args: unknown[]) => denied('ui.components', 'components.provide') } as unknown as ExtensionServices['components'])

  const notifications = effective.has('notifications')
    ? services.notifications
    : ({
        info: (..._args: unknown[]) => denied('notifications', 'notifications.info'),
        warning: (..._args: unknown[]) => denied('notifications', 'notifications.warning'),
        error: (..._args: unknown[]) => denied('notifications', 'notifications.error'),
      } as unknown as ExtensionServices['notifications'])

  return { commands: commands as unknown as ExtensionServices['commands'], events, storage, components, notifications }
}

function isOwnCommand(extensionId: string, command: unknown): boolean {
  try {
    if (typeof command === 'string') return isValidContributionId(command) && command.startsWith(`${extensionId}.`)
    if (typeof command !== 'object' || command === null) return false
    const candidate = command as { kind?: unknown; id?: unknown }
    return candidate.kind === 'command' && typeof candidate.id === 'string' && isValidContributionId(candidate.id) && candidate.id.startsWith(`${extensionId}.`)
  } catch {
    return false
  }
}
