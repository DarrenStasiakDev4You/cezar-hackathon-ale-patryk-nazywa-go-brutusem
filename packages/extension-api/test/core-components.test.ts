import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  checkComponentCompatibility,
  TaskHeaderMain,
  type ComponentContract,
  type ComponentImplementation,
  type IsJson,
  type TaskHeaderMainProps,
  type TaskHeaderTask,
  type TaskRef,
} from '@open-mercato/cezar-extension-api'

describe('core component contracts', () => {
  it('declares cezar.task.header.main@1 as a frozen token', () => {
    expect(TaskHeaderMain).toEqual({
      kind: 'component',
      id: 'cezar.task.header.main',
      version: 1,
      requiredCapabilities: ['shows-title', 'shows-status'],
      optionalCapabilities: ['shows-meta'],
      layout: { minBlockSize: 30 },
    })
    expect(Object.isFrozen(TaskHeaderMain)).toBe(true)
    expect(Object.isFrozen(TaskHeaderMain.requiredCapabilities)).toBe(true)
    expect(Object.isFrozen(TaskHeaderMain.optionalCapabilities)).toBe(true)
    expect(Object.isFrozen(TaskHeaderMain.layout)).toBe(true)
  })

  it('types the token with its props, which are JSON', () => {
    expectTypeOf(TaskHeaderMain).toEqualTypeOf<ComponentContract<TaskHeaderMainProps>>()
    expectTypeOf<IsJson<TaskHeaderMainProps>>().toEqualTypeOf<true>()
  })

  it('names the task so it can be passed straight to the task commands', () => {
    expectTypeOf<TaskHeaderTask>().toExtend<TaskRef>()
  })

  it('needs shows-title and shows-status, and takes shows-meta as optional', () => {
    const Header = () => null
    const implementation = (capabilities: readonly string[]): ComponentImplementation<TaskHeaderMainProps> => ({
      id: 'acme.jira.task-header',
      title: 'Jira header',
      capabilities,
      component: Header,
    })

    expect(checkComponentCompatibility(TaskHeaderMain, implementation(['shows-status', 'shows-title']))).toEqual({
      compatible: true,
      issues: [],
      capabilities: ['shows-title', 'shows-status'],
    })
    expect(
      checkComponentCompatibility(TaskHeaderMain, implementation(['shows-title', 'shows-status', 'shows-meta'])).capabilities,
    ).toEqual(['shows-title', 'shows-status', 'shows-meta'])
    expect(checkComponentCompatibility(TaskHeaderMain, implementation(['shows-title'])).issues).toEqual([
      expect.objectContaining({ code: 'missing-capability', capability: 'shows-status' }),
    ])
  })
})
