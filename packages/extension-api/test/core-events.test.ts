import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  ExtensionActivated,
  type EventToken,
  type ExtensionActivation,
} from '@open-mercato/cezar-extension-api'

describe('core event tokens', () => {
  it('are frozen { kind, id } tokens under the reserved cezar publisher', () => {
    expect([ExtensionActivated]).toEqual([{ kind: 'event', id: 'cezar.extension.activated' }])
    for (const token of [ExtensionActivated]) expect(Object.isFrozen(token)).toBe(true)
  })

  it('carry a narrow payload', () => {
    expectTypeOf(ExtensionActivated).toEqualTypeOf<EventToken<ExtensionActivation>>()
    const activation: ExtensionActivation = { extensionId: 'acme.alpha', version: '1.0.0' }
    // @ts-expect-error — an activation names its extension
    const missing: ExtensionActivation = { version: '1.0.0' }
    expect([activation, missing]).toHaveLength(2)
  })
})
