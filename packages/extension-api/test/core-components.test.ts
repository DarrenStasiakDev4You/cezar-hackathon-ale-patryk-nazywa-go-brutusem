import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  checkComponentCompatibility,
  TaskHeaderMain,
  type ComponentContract,
  type ComponentImplementation,
  type IsJson,
  type TaskHeaderActionState,
  type TaskHeaderMainProps,
  type TaskHeaderTask,
  type TaskRef,
} from '@open-mercato/cezar-extension-api'

/** The seven intents: the only functions a header's props may hold. */
type Intent = 'onContinue' | 'onStop' | 'onArchive' | 'onRename' | 'onResolveConflicts' | 'onNavigate' | 'onChooseEngine'

/** Every key of `T` whose value is a function. */
type FunctionKeys<T> = { [K in keyof T]-?: NonNullable<T[K]> extends (...args: never[]) => unknown ? K : never }[keyof T]

describe('core component contracts', () => {
  it('declares cezar.task.header.main@1 as a frozen token', () => {
    expect(TaskHeaderMain).toEqual({
      kind: 'component',
      id: 'cezar.task.header.main',
      version: 1,
      requiredCapabilities: ['shows-title', 'shows-status'],
      optionalCapabilities: ['shows-meta', 'offers-continue', 'offers-stop', 'offers-archive'],
      layout: { minBlockSize: 30 },
    })
    expect(Object.isFrozen(TaskHeaderMain)).toBe(true)
    expect(Object.isFrozen(TaskHeaderMain.requiredCapabilities)).toBe(true)
    expect(Object.isFrozen(TaskHeaderMain.optionalCapabilities)).toBe(true)
    expect(Object.isFrozen(TaskHeaderMain.layout)).toBe(true)
  })

  it('types the token with its props', () => {
    expectTypeOf(TaskHeaderMain).toEqualTypeOf<ComponentContract<TaskHeaderMainProps>>()
  })

  it('keeps every data prop JSON', () => {
    expectTypeOf<IsJson<Omit<TaskHeaderMainProps, Intent>>>().toEqualTypeOf<true>()
    // The check is not blind: the props with their intents are not JSON.
    expectTypeOf<IsJson<TaskHeaderMainProps>>().toEqualTypeOf<false>()
  })

  it('holds no function but the seven intents, and every intent returns void', () => {
    expectTypeOf<FunctionKeys<TaskHeaderMainProps>>().toEqualTypeOf<Intent>()
    expectTypeOf<ReturnType<TaskHeaderMainProps[Intent]>>().toEqualTypeOf<void>()
    expectTypeOf<TaskHeaderMainProps['onResolveConflicts']>().parameters.toEqualTypeOf<[prNumber: number]>()
    expectTypeOf<TaskHeaderMainProps['onNavigate']>().parameters.toEqualTypeOf<[href: string]>()
    expectTypeOf<Parameters<TaskHeaderMainProps['onContinue']>>().toEqualTypeOf<[]>()
  })

  it('names the task so it can be passed straight to the task commands', () => {
    expectTypeOf<TaskHeaderTask>().toExtend<TaskRef>()
  })

  it('gives every action the same state', () => {
    expectTypeOf<TaskHeaderMainProps['actions'][keyof TaskHeaderMainProps['actions']]>().toEqualTypeOf<TaskHeaderActionState>()
  })

  it('lets an implementation offer Continue, Stop and Archive one by one', () => {
    const offering = (capabilities: readonly string[]): ComponentImplementation<TaskHeaderMainProps> => ({
      id: 'acme.compact.row',
      title: 'Compact row',
      capabilities,
      component: () => null,
    })

    expect(
      checkComponentCompatibility(TaskHeaderMain, offering(['shows-title', 'shows-status', 'offers-stop', 'offers-continue'])).capabilities,
    ).toEqual(['shows-title', 'shows-status', 'offers-continue', 'offers-stop'])
    // A name the contract does not know is ignored, never an offer.
    expect(
      checkComponentCompatibility(TaskHeaderMain, offering(['shows-title', 'shows-status', 'offers-delete'])).capabilities,
    ).toEqual(['shows-title', 'shows-status'])
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
      missingCapabilities: [],
      customCapabilities: [],
    })
    expect(
      checkComponentCompatibility(TaskHeaderMain, implementation(['shows-title', 'shows-status', 'shows-meta'])).capabilities,
    ).toEqual(['shows-title', 'shows-status', 'shows-meta'])
    expect(checkComponentCompatibility(TaskHeaderMain, implementation(['shows-title'])).issues).toEqual([
      expect.objectContaining({ code: 'missing-capability', capability: 'shows-status' }),
    ])
  })
})
