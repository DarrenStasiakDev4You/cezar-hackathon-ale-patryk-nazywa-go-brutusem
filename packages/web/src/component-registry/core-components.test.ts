import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  checkComponentCompatibility,
  TaskHeaderMain,
  type ComponentContract,
  type ComponentImplementation,
  type TaskHeaderMainProps,
} from '@open-mercato/cezar-extension-api'

import { fakeScope } from '../extensions/registry.fixtures'
import { createCoreComponentRegistry, registerCoreComponents } from './core-components'
import { ComponentsProvider, useComponentRegistry } from './provider'
import { CORE_COMPONENT_CONTRACTS } from './core-contracts'
import { createComponentRegistry, type AnyComponentContract } from './registry'
import { coreDefaultComponentId, missingCoreDefaults, resolveComponent } from './resolve'

/** Core's one registration, the task header main part, captured from what `registerCoreComponents`
 *  hands to `register`: the implementation objects stay private to it. */
interface Registered {
  readonly contract: AnyComponentContract
  readonly implementation: ComponentImplementation<TaskHeaderMainProps>
}

function registered(): Registered[] {
  const seen: Registered[] = []
  registerCoreComponents({
    register<P>(contract: ComponentContract<P>, implementation: ComponentImplementation<P>) {
      // Only `TaskHeaderMain` is served; the first test pins that.
      seen.push({ contract, implementation: implementation as unknown as ComponentImplementation<TaskHeaderMainProps> })
      return { dispose() {} }
    },
  })
  return seen
}

describe('core defaults: the gate', () => {
  it('serves the task header’s main part', () => {
    expect(CORE_COMPONENT_CONTRACTS).toEqual([TaskHeaderMain])
  })

  it('leaves no served contract without core’s default on the registry main.tsx builds', () => {
    expect(missingCoreDefaults(createCoreComponentRegistry(), CORE_COMPONENT_CONTRACTS)).toEqual([])
  })

  it('fails without registerCoreComponents, so the check is shown to fail', () => {
    const registry = createComponentRegistry({ contracts: CORE_COMPONENT_CONTRACTS })

    expect(missingCoreDefaults(registry, CORE_COMPONENT_CONTRACTS)).toEqual(['cezar.task.header.main'])
  })

  it('gives a ComponentsProvider without a registry the same catalog, with core’s default for the header', () => {
    const { result } = renderHook(() => resolveComponent(useComponentRegistry(), TaskHeaderMain), {
      wrapper: ComponentsProvider,
    })

    if (result.current.status !== 'resolved') throw new Error('expected core’s default')
    expect(result.current.component.componentId).toBe('cezar.task.header.main.default')
    expect(result.current.component.extensionId).toBeNull()
  })

  it('passes the factory’s other options through, and always serves the core catalog', () => {
    const diagnostics: string[] = []
    const registry = createCoreComponentRegistry({ onDiagnostic: (registration) => diagnostics.push(registration.componentId) })
    registry.forExtension(fakeScope('acme.old').scope).provide({ ...TaskHeaderMain, version: 2 }, {
      id: 'acme.old.task-header',
      title: 'Old header',
      component: () => null,
    })

    expect(diagnostics).toEqual(['acme.old.task-header'])
    expect(registry.listUsable(TaskHeaderMain).map((usable) => usable.componentId)).toEqual(['cezar.task.header.main.default'])
  })
})

describe('core’s task header main part', () => {
  it('is registered once, for TaskHeaderMain, and fits it with all three capabilities', () => {
    const [only, ...others] = registered()

    expect(others).toEqual([])
    expect(only?.contract).toBe(TaskHeaderMain)
    expect(checkComponentCompatibility(TaskHeaderMain, only!.implementation)).toEqual({
      compatible: true,
      issues: [],
      capabilities: ['shows-title', 'shows-status', 'shows-meta'],
    })
  })

  it('is core’s default, which renders and is always the fallback', () => {
    const registry = createCoreComponentRegistry()

    expect(registry.get(coreDefaultComponentId(TaskHeaderMain.id))).toMatchObject({
      componentId: 'cezar.task.header.main.default',
      extensionId: null,
      compatible: true,
      component: registered()[0]?.implementation.component,
    })
    const resolution = resolveComponent(registry, TaskHeaderMain)
    if (resolution.status !== 'resolved') throw new Error('expected core’s default')
    expect(resolution.component.componentId).toBe('cezar.task.header.main.default')
    expect(resolution.fallback).toBe(resolution.component)
  })

  it('keeps core’s id: registered before the extension host, it cannot be taken by an extension', () => {
    const registry = createCoreComponentRegistry()
    const components = registry.forExtension(fakeScope('cezar.task').scope)
    const implementation = registered()[0]!.implementation

    expect(() => components.provide(TaskHeaderMain, { ...implementation, title: 'Impostor header' })).toThrow(
      /already provided by core/,
    )
    expect(registry.get('cezar.task.header.main.default')?.extensionId).toBeNull()
  })
})
