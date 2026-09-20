import { describe, expect, it } from 'vitest'

import { checkComponentCompatibility, TaskComposer } from '@open-mercato/cezar-extension-api'

import plain from '../examples/plain-task-composer/index.ts'
import { createFakeContext } from './fake-context.ts'

describe('plain Task Composer example', () => {
  it('activates a minimal external implementation against TaskComposer@1', async () => {
    const fake = createFakeContext(plain.manifest)
    await plain.activate(fake.context)
    const registration = fake.components.get('example.plain-composer.box')
    if (!registration) throw new Error('plain composer was not provided')

    expect(registration.contract).toEqual(TaskComposer)
    expect(checkComponentCompatibility(TaskComposer, registration.implementation, registration.contract)).toEqual({
      compatible: true,
      issues: [],
      capabilities: ['edits-draft', 'sends', 'shows-availability'],
      customCapabilities: [],
      missingCapabilities: [],
    })
  })
})
