import { afterEach, describe, expect, it, vi } from 'vitest'

import { isExtensionError } from '@open-mercato/cezar-extension-api'

import { fakeScope } from './registry.fixtures'
import { createNotificationService } from './notifications'

afterEach(() => vi.useRealTimers())

describe('createNotificationService', () => {
  it('maps tones, prefixes the display name and validates input', () => {
    const notify = vi.fn()
    const service = createNotificationService({ notify })
    const { scope } = fakeScope('acme.alerts')
    const notifications = service.forExtension(scope)

    notifications.info('Ready')
    notifications.warning('Check this')
    notifications.error('Broken')

    expect(notify.mock.calls).toEqual([
      ['Fixture acme.alerts: Ready', { tone: 'default' }],
      ['Fixture acme.alerts: Check this', { tone: 'warning' }],
      ['Fixture acme.alerts: Broken', { tone: 'danger' }],
    ])
    expect(() => notifications.info('')).toThrowError(/non-empty string/)
    expect(() => notifications.info('x'.repeat(501))).toThrowError(/500 characters/)
    expect(notify).toHaveBeenCalledTimes(3)
  })

  it('drops the sixth message in a sliding window and reports once, then reopens', () => {
    vi.useFakeTimers()
    const notify = vi.fn()
    const onDropped = vi.fn()
    const service = createNotificationService({ notify, onDropped })
    const { scope } = fakeScope('acme.alerts')
    const notifications = service.forExtension(scope)

    for (let index = 0; index < 5; index += 1) notifications.info(`message ${index}`)
    notifications.info('dropped one')
    notifications.info('dropped two')

    expect(notify).toHaveBeenCalledTimes(5)
    expect(onDropped).toHaveBeenCalledTimes(1)
    expect(onDropped).toHaveBeenCalledWith('acme.alerts')

    vi.advanceTimersByTime(10_000)
    notifications.info('new window')
    expect(notify).toHaveBeenCalledTimes(6)
  })

  it('rate-limits each extension independently and checks liveness before validation', () => {
    const notify = vi.fn()
    const service = createNotificationService({ notify })
    const first = fakeScope('acme.first')
    const second = fakeScope('acme.second')

    for (let index = 0; index < 5; index += 1) service.forExtension(first.scope).info(`${index}`)
    service.forExtension(second.scope).info('allowed')
    expect(notify).toHaveBeenCalledTimes(6)

    first.end()
    expect(() => service.forExtension(first.scope).info('')).toThrowError(/deactivated/)
    expect(isExtensionError(tryCall(() => service.forExtension(first.scope).warning('late')), 'disposed')).toBe(true)
  })
})

function tryCall(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}
