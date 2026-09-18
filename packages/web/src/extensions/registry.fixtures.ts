import { defineExtension, type Extension, type ExtensionManifest } from '@open-mercato/cezar-extension-api'

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
