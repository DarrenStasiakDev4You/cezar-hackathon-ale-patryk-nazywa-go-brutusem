import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  checkComponentCompatibility,
  TaskHeader,
  type ComponentContract,
  type ComponentImplementation,
  type IsJson,
  type TaskHeaderActionState,
  type TaskHeaderProps,
  type TaskHeaderTask,
  type TaskRef,
} from '@open-mercato/cezar-extension-api'

/** The seven intents: the only functions a header's props may hold. */
type Intent = 'onContinue' | 'onStop' | 'onArchive' | 'onRename' | 'onResolveConflicts' | 'onNavigate' | 'onChooseEngine'

/** Every key of `T` whose value is a function. */
type FunctionKeys<T> = { [K in keyof T]-?: NonNullable<T[K]> extends (...args: never[]) => unknown ? K : never }[keyof T]

describe('core component contracts', () => {
  it('declares task.header@1 as a frozen token', () => {
    expect(TaskHeader).toEqual({
      kind: 'component',
      id: 'task.header',
      version: 1,
      requiredCapabilities: ['shows-title', 'shows-status'],
      optionalCapabilities: ['shows-meta', 'offers-continue', 'offers-stop', 'offers-archive'],
      layout: { minBlockSize: 30 },
    })
    expect(Object.isFrozen(TaskHeader)).toBe(true)
    expect(Object.isFrozen(TaskHeader.requiredCapabilities)).toBe(true)
    expect(Object.isFrozen(TaskHeader.optionalCapabilities)).toBe(true)
    expect(Object.isFrozen(TaskHeader.layout)).toBe(true)
  })

  it('types the token with its props', () => {
    expectTypeOf(TaskHeader).toEqualTypeOf<ComponentContract<TaskHeaderProps>>()
  })

  it('keeps every data prop JSON', () => {
    expectTypeOf<IsJson<Omit<TaskHeaderProps, Intent>>>().toEqualTypeOf<true>()
    // The check is not blind: the props with their intents are not JSON.
    expectTypeOf<IsJson<TaskHeaderProps>>().toEqualTypeOf<false>()
  })

  it('holds no function but the seven intents, and every intent returns void', () => {
    expectTypeOf<FunctionKeys<TaskHeaderProps>>().toEqualTypeOf<Intent>()
    expectTypeOf<ReturnType<TaskHeaderProps[Intent]>>().toEqualTypeOf<void>()
    expectTypeOf<TaskHeaderProps['onResolveConflicts']>().parameters.toEqualTypeOf<[prNumber: number]>()
    expectTypeOf<TaskHeaderProps['onNavigate']>().parameters.toEqualTypeOf<[href: string]>()
    expectTypeOf<Parameters<TaskHeaderProps['onContinue']>>().toEqualTypeOf<[]>()
  })

  it('names the task so it can be passed straight to the task commands', () => {
    expectTypeOf<TaskHeaderTask>().toExtend<TaskRef>()
  })

  it('gives every action the same state', () => {
    expectTypeOf<TaskHeaderProps['actions'][keyof TaskHeaderProps['actions']]>().toEqualTypeOf<TaskHeaderActionState>()
  })

  it('lets an implementation offer Continue, Stop and Archive one by one', () => {
    const offering = (capabilities: readonly string[]): ComponentImplementation<TaskHeaderProps> => ({
      id: 'acme.compact.row',
      title: 'Compact row',
      capabilities,
      component: () => null,
    })

    expect(
      checkComponentCompatibility(TaskHeader, offering(['shows-title', 'shows-status', 'offers-stop', 'offers-continue'])).capabilities,
    ).toEqual(['shows-title', 'shows-status', 'offers-continue', 'offers-stop'])
    // A name the contract does not know is ignored, never an offer.
    expect(
      checkComponentCompatibility(TaskHeader, offering(['shows-title', 'shows-status', 'offers-delete'])).capabilities,
    ).toEqual(['shows-title', 'shows-status'])
  })

  it('needs shows-title and shows-status, and takes shows-meta as optional', () => {
    const Header = () => null
    const implementation = (capabilities: readonly string[]): ComponentImplementation<TaskHeaderProps> => ({
      id: 'acme.jira.task-header',
      title: 'Jira header',
      capabilities,
      component: Header,
    })

    expect(checkComponentCompatibility(TaskHeader, implementation(['shows-status', 'shows-title']))).toEqual({
      compatible: true,
      issues: [],
      capabilities: ['shows-title', 'shows-status'],
    })
    expect(
      checkComponentCompatibility(TaskHeader, implementation(['shows-title', 'shows-status', 'shows-meta'])).capabilities,
    ).toEqual(['shows-title', 'shows-status', 'shows-meta'])
    expect(checkComponentCompatibility(TaskHeader, implementation(['shows-title'])).issues).toEqual([
      expect.objectContaining({ code: 'missing-capability', capability: 'shows-status' }),
    ])
  })
})
