import {
  defineCommand,
  defineExtension,
  type Disposable,
  type Extension,
  type ExtensionManifest,
} from '@open-mercato/cezar-extension-api'

import type { ExtensionScope, ExtensionServices } from './registry'

/**
 * Test fixtures for the extension registry and host. Extensions are written with
 * `defineExtension` imported by PACKAGE NAME, as a real extension would.
 */

export function fixtureManifest(id: string): ExtensionManifest {
  return { id, name: `Fixture ${id}`, version: '1.0.0', engines: { cezar: '^0.11.0' } }
}

/** A valid extension whose `activate` does nothing unless `hooks` says otherwise. */
export function fixture(id: string, hooks: Partial<Pick<Extension, 'activate' | 'deactivate'>> = {}): Extension {
  return defineExtension({
    manifest: fixtureManifest(id),
    activate: hooks.activate ?? (() => {}),
    ...(hooks.deactivate === undefined ? {} : { deactivate: hooks.deactivate }),
  })
}

/** A command token for fixtures to register through the recording services. */
export const pingCommand = (extensionId: string) => defineCommand(`${extensionId}.ping`)

/** A Disposable that appends `label` to `log` each time it is disposed. */
export function disposable(log: string[], label: string): Disposable {
  return { dispose: () => void log.push(label) }
}

export interface RecordingServices {
  readonly services: (scope: ExtensionScope) => ExtensionServices
  /** Every scope handed to `services`, one per activation, in order. */
  readonly scopes: ExtensionScope[]
}

/**
 * A `services` factory that takes part in the lifecycle the way a real service must: every
 * method first calls `scope.assertLive()`, and every registration is `scope.track()`ed. A disposed
 * registration appends `dispose <kind> <id>` to `log`.
 */
export function recordingServices(log: string[] = []): RecordingServices {
  const scopes: ExtensionScope[] = []
  const services = (scope: ExtensionScope): ExtensionServices => {
    scopes.push(scope)
    const register = (label: string): Disposable => {
      scope.assertLive()
      return scope.track(disposable(log, `dispose ${label}`))
    }
    const live = async (): Promise<never> => {
      scope.assertLive()
      return undefined as never
    }
    return {
      commands: {
        register: (command) => register(`command ${command.id}`),
        execute: live,
        has: () => {
          scope.assertLive()
          return false
        },
      },
      events: { on: (event) => register(`listener ${event.id}`), emit: () => scope.assertLive() },
      storage: { get: live, set: live, delete: live, keys: live },
      components: { provide: (_contract, implementation) => register(`component ${implementation.id}`) },
    }
  }
  return { services, scopes }
}

export interface Deferred {
  readonly promise: Promise<void>
  resolve(): void
  reject(error: unknown): void
}

export function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
