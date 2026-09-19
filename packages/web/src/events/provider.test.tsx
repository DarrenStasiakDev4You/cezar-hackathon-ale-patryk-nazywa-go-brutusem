import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { createEventBus, type EventBus } from './bus'
import { EventBusProvider, useEventBus } from './provider'

afterEach(() => {
  cleanup()
})

function wrapper(bus?: EventBus) {
  return ({ children }: { children: ReactNode }) => <EventBusProvider bus={bus}>{children}</EventBusProvider>
}

describe('EventBusProvider / useEventBus', () => {
  it('hands the page’s own bus to the tree', () => {
    const bus = createEventBus()

    const { result } = renderHook(() => useEventBus(), { wrapper: wrapper(bus) })

    expect(result.current).toBe(bus)
  })

  it('creates one bus of its own when none is given, and keeps it across renders', () => {
    const { result, rerender } = renderHook(() => useEventBus(), { wrapper: wrapper() })
    const first = result.current

    rerender()

    expect(first).not.toBeNull()
    expect(typeof first?.forExtension).toBe('function')
    expect(result.current).toBe(first)
  })

  it('answers null outside the provider instead of throwing', () => {
    const { result } = renderHook(() => useEventBus())

    expect(result.current).toBeNull()
  })
})
