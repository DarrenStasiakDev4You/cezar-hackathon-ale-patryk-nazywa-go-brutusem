import { describe, expect, it, vi } from 'vitest'

import {
  defineCommand,
  defineEvent,
  isExtensionError,
} from '@open-mercato/cezar-extension-api'

import {
  builtinGrant,
  checkPermissions,
  guardServices,
  permissionDeniedError,
  STANDARD_PERMISSIONS,
} from './permissions'
import { fakeScope, fixtureManifest } from './registry.fixtures'
import type { ExtensionServices } from './registry'

describe('permission checks', () => {
  it('recognises the supported vocabulary and accepts an omitted request', () => {
    expect(checkPermissions(fixtureManifest('acme.ok', ['storage']), ['storage'])).toBeNull()
    expect(checkPermissions(fixtureManifest('acme.empty', []), [])).toBeNull()
    expect(builtinGrant(fixtureManifest('acme.all'))).toEqual(Object.keys(STANDARD_PERMISSIONS))
  })

  it('reports all unsupported permissions before missing grants', () => {
    const manifest = fixtureManifest('acme.bad', ['teleport.machine', 'shell'] as never)
    expect(checkPermissions(manifest, [])).toEqual({
      code: 'unsupported-permission',
      message:
        'Extension "acme.bad" is incompatible with this Cezar. Unknown or unsupported permission: teleport.machine, shell.',
    })
  })

  it('reports every requested permission missing from the grant', () => {
    expect(checkPermissions(fixtureManifest('acme.missing', ['storage', 'events']), ['storage'])).toEqual({
      code: 'permission-not-granted',
      message: 'Extension "acme.missing" requests permissions that have not been approved: events.',
    })
  })

  it('returns the denial error with stable duck-typed fields and no arguments', () => {
    const error = permissionDeniedError('acme.hello', 'storage', 'storage.set')
    expect(isExtensionError(error, 'permission-denied')).toBe(true)
    expect(error).toMatchObject({ permission: 'storage', api: 'storage.set' })
    expect(error.message).toBe(
      'Extension "acme.hello" called context.storage.set() without the "storage" permission. Add "storage" to "permissions" in its manifest.',
    )
    expect(error.message).not.toContain('secret')
  })
})

describe('guardServices', () => {
  function services(): ExtensionServices {
    return {
      commands: {
        register: vi.fn(() => ({ dispose() {} })),
        execute: vi.fn(async () => 'executed') as unknown as ExtensionServices['commands']['execute'],
        has: vi.fn(() => true),
      },
      events: {
        on: vi.fn(() => ({ dispose() {} })),
        once: vi.fn(() => ({ dispose() {} })),
        off: vi.fn(),
        emit: vi.fn(),
      },
      storage: {
        get: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        keys: vi.fn(async () => []),
      },
      components: { provide: vi.fn(() => ({ dispose() {} })) },
      notifications: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
    }
  }

  it('denies every protected service without reaching the real service', async () => {
    const real = services()
    const { scope } = fakeScope('acme.guard')
    const guarded = guardServices(scope, real, new Set())

    expect(Object.isFrozen(guarded.commands)).toBe(true)
    expect(() => guarded.events.on({} as never, () => {})).toThrow(/events.on/)
    expect(() => guarded.components.provide({} as never, {} as never)).toThrow(/ui.components/)
    await expect(guarded.storage.set('key', 1)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(() => guarded.notifications.warning('warn')).toThrow(/notifications.warning/)
    expect(real.events.on).not.toHaveBeenCalled()
    expect(real.components.provide).not.toHaveBeenCalled()
    expect(real.storage.set).not.toHaveBeenCalled()
    expect(real.notifications.warning).not.toHaveBeenCalled()
  })

  it('allows registration and own commands without commands.execute, but denies other commands', async () => {
    const real = services()
    const { scope } = fakeScope('acme.guard')
    const guarded = guardServices(scope, real, new Set())
    const own = defineCommand('acme.guard.own')
    const core = defineCommand('cezar.task.stop')

    guarded.commands.register(own, () => undefined)
    await expect(guarded.commands.execute(own)).resolves.toBe('executed')
    expect(guarded.commands.has(own)).toBe(true)
    expect(guarded.commands.has(core)).toBe(false)
    await expect(guarded.commands.execute(core)).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(guarded.commands.execute({ bad: true } as never)).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(guarded.commands.execute({ kind: 'event', id: 'acme.guard.own' } as never)).rejects.toMatchObject({
      code: 'permission-denied',
    })
    expect(real.commands.register).toHaveBeenCalled()
    expect(real.commands.execute).toHaveBeenCalledWith(own)
  })

  it('preserves the service receiver and makes disposed win over denial', async () => {
    class Storage {
      value = 'class value'
      async get() {
        return this.value
      }
    }
    const storage = new Storage()
    const real = { ...services(), storage } as unknown as ExtensionServices
    const activation = fakeScope('acme.guard')
    const guarded = guardServices(activation.scope, real, new Set(['storage']))
    await expect(guarded.storage.get('key')).resolves.toBe('class value')

    const denied = guardServices(activation.scope, real, new Set())
    activation.end()
    await expect(denied.storage.get('key')).rejects.toMatchObject({ code: 'disposed' })
    expect(() => denied.events.emit(defineEvent('acme.guard.event'))).toThrow(/deactivated/)
  })
})
