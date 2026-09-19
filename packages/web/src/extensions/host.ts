import type { Extension } from '@open-mercato/cezar-extension-api'

import type { CommandRegistry } from '../commands/registry'
import {
  createExtensionRegistry,
  logExtensionError,
  type ExtensionRecord,
  type ExtensionRegistry,
  type ExtensionRegistryOptions,
} from './registry'

/**
 * Placeholder services until the commands, events, storage and components items land, each one
 * replacing its placeholder behind the same `services(scope)` seam.
 *
 * Every method first calls `scope.assertLive()` (so a call after deactivation fails with
 * `disposed`, as the contract says), then fails with
 * "context.<service> is not available in this Cezar version yet". Methods that return a promise
 * reject; the others throw.
 */
export const unavailableServices: ExtensionRegistryOptions['services'] = (scope) => {
  const fails = (service: string) => (): never => {
    scope.assertLive()
    throw new Error(`context.${service} is not available in this Cezar version yet`)
  }
  const rejects = (service: string) => {
    const fail = fails(service)
    return async (): Promise<never> => fail()
  }
  return {
    commands: { register: fails('commands'), execute: rejects('commands'), has: fails('commands') },
    events: { on: fails('events'), emit: fails('events') },
    storage: {
      get: rejects('storage'),
      set: rejects('storage'),
      delete: rejects('storage'),
      keys: rejects('storage'),
    },
    components: { provide: fails('components') },
  }
}

/**
 * The services the cockpit gives each activation: the real `commands` — the command registry's
 * extension view (spec `2026-09-19-command-api`) — with events, storage and components still the
 * {@link unavailableServices} placeholders until their items land.
 */
export function cockpitServices(deps: { readonly commands: CommandRegistry }): ExtensionRegistryOptions['services'] {
  return (scope) => ({ ...unavailableServices(scope), commands: deps.commands.forExtension(scope) })
}

/**
 * Creates the cockpit's registry, registers `extensions` (a bad or duplicate entry is reported
 * through `onError` and skipped; the rest still register) and starts `activateAll()`.
 * Never throws; `ready` never rejects — the boot must not depend on any extension (AGENTS.md
 * § Zero config).
 */
export function startExtensionHost(options: {
  readonly extensions: readonly Extension[]
  readonly services?: ExtensionRegistryOptions['services']
  readonly onError?: ExtensionRegistryOptions['onError']
}): { readonly registry: ExtensionRegistry; readonly ready: Promise<readonly ExtensionRecord[]> } {
  const onError = options.onError ?? logExtensionError
  const registry = createExtensionRegistry({
    services: options.services ?? unavailableServices,
    onError,
  })

  for (const extension of options.extensions) {
    try {
      registry.register(extension)
    } catch (error) {
      try {
        onError({ id: describeId(extension), phase: 'register', error })
      } catch {
        // A throwing reporter must not break the boot.
      }
    }
  }

  return { registry, ready: registry.activateAll() }
}

/** The id to report a registration failure under, even for a value that is not an extension. */
function describeId(extension: unknown): string {
  try {
    const id = (extension as { manifest?: { id?: unknown } } | null)?.manifest?.id
    return typeof id === 'string' && id !== '' ? id : '(no id)'
  } catch {
    return '(no id)'
  }
}
