import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  checkComponentCompatibility,
  TaskComposer,
  TaskHeaderMain,
  type ComponentContract,
  type ComponentImplementation,
  type IsJson,
  type TaskHeaderActionState,
  type TaskHeaderMainProps,
  type TaskHeaderTask,
  type TaskComposerFile,
  type TaskComposerProps,
  type TaskRef,
} from '@open-mercato/cezar-extension-api'

/** The seven intents: the only functions a header's props may hold. */
type Intent = 'onContinue' | 'onStop' | 'onArchive' | 'onRename' | 'onResolveConflicts' | 'onNavigate' | 'onChooseEngine'
type ComposerIntent =
  | 'onTextChange'
  | 'onSubmit'
  | 'onAttachFiles'
  | 'onRemoveAttachment'
  | 'onSelectRunner'
  | 'onSelectModel'
  | 'onRequestCompletions'
  | 'onUseSkill'
  | 'onNavigate'

/** Every key of `T` whose value is a function. */
type FunctionKeys<T> = { [K in keyof T]-?: NonNullable<T[K]> extends (...args: never[]) => unknown ? K : never }[keyof T]

describe('core component contracts', () => {
  it('declares cezar.task.composer@1 as a frozen token', () => {
    expect(TaskComposer).toEqual({
      kind: 'component',
      id: 'cezar.task.composer',
      version: 1,
      requiredCapabilities: ['edits-draft', 'sends', 'shows-availability', 'attaches-files', 'chooses-engine'],
      optionalCapabilities: [],
      layout: { minBlockSize: 88 },
    })
    expect(Object.isFrozen(TaskComposer)).toBe(true)
    expect(Object.isFrozen(TaskComposer.requiredCapabilities)).toBe(true)
    expect(Object.isFrozen(TaskComposer.optionalCapabilities)).toBe(true)
    expect(Object.isFrozen(TaskComposer.layout)).toBe(true)
  })

  it('keeps the composer model JSON and limits functions to its nine intents', () => {
    expectTypeOf<TaskComposerProps>().toHaveProperty('draft')
    expectTypeOf<TaskComposerFile>().toHaveProperty('arrayBuffer')
    expectTypeOf<FunctionKeys<TaskComposerProps>>().toEqualTypeOf<ComposerIntent>()
    expectTypeOf<IsJson<Omit<TaskComposerProps, ComposerIntent>>>().toEqualTypeOf<true>()
    expectTypeOf<ReturnType<TaskComposerProps[ComposerIntent]>>().toEqualTypeOf<void>()
    expectTypeOf<TaskComposerProps['onAttachFiles']>().parameters.toEqualTypeOf<[
      files: readonly TaskComposerFile[],
      source: 'file' | 'clipboard',
    ]>()
    expectTypeOf<TaskComposerProps['onSubmit']>().parameters.toEqualTypeOf<[]>()
  })

  it('types the composer token with its public props', () => {
    expectTypeOf(TaskComposer).toEqualTypeOf<ComponentContract<TaskComposerProps>>()
  })

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
