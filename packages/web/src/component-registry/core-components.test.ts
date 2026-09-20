import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  checkComponentCompatibility,
  TaskComposer,
  TaskHeader,
  type ComponentContract,
  type ComponentImplementation,
  type TaskHeaderProps,
} from '@open-mercato/cezar-extension-api'

import { fakeScope } from '../extensions/registry.fixtures'
import { createCoreComponentRegistry, registerCoreComponents } from './core-components'
import { ComponentsProvider, useComponentRegistry } from './provider'
import { CORE_COMPONENT_CONTRACTS } from './core-contracts'
import { createComponentRegistry, type AnyComponentContract } from './registry'
import { missingDefaults, resolveComponent } from './resolve'

/** Core's one registration, the task header main part, captured from what `registerCoreComponents`
 *  hands to `register`: the implementation objects stay private to it. */
interface Registered {
  readonly contract: AnyComponentContract
  readonly implementation: ComponentImplementation<TaskHeaderProps>
}

function registered(): Registered[] {
  const seen: Registered[] = []
  registerCoreComponents({
    register<P, Settings>(contract: ComponentContract<P>, implementation: ComponentImplementation<P, Settings>) {
      // The first registration is the task header; the second is the composer.
      seen.push({ contract, implementation: implementation as unknown as ComponentImplementation<TaskHeaderProps> })
      return { dispose() {} }
    },
  })
  return seen
}

describe('core defaults: the gate', () => {
  it('serves the task header’s main part', () => {
    expect(CORE_COMPONENT_CONTRACTS).toEqual([TaskHeader, TaskComposer])
  })

  it('leaves no served contract without core’s default on the registry main.tsx builds', () => {
    expect(missingDefaults(createCoreComponentRegistry(), CORE_COMPONENT_CONTRACTS)).toEqual([])
  })

  it('fails without registerCoreComponents, so the check is shown to fail', () => {
    const registry = createComponentRegistry({ contracts: CORE_COMPONENT_CONTRACTS })

    expect(missingDefaults(registry, CORE_COMPONENT_CONTRACTS)).toEqual(['task.header', 'cezar.task.composer'])
  })

  it('gives a ComponentsProvider without a registry the same catalog, with core’s default for the header', () => {
    const { result } = renderHook(() => resolveComponent(useComponentRegistry(), TaskHeader), {
      wrapper: ComponentsProvider,
    })

    if (result.current.status !== 'resolved') throw new Error('expected core’s default')
    expect(result.current.component.componentId).toBe('core.task-header')
    expect(result.current.component.extensionId).toBeNull()
  })

  it('passes the factory’s other options through, and always serves the core catalog', () => {
    const diagnostics: string[] = []
    const registry = createCoreComponentRegistry({ onDiagnostic: (registration) => diagnostics.push(registration.componentId) })
    registry.forExtension(fakeScope('acme.old').scope).provide({ ...TaskHeader, version: 2 }, {
      id: 'acme.old.task-header',
      title: 'Old header',
      component: () => null,
    })

    expect(diagnostics).toEqual(['acme.old.task-header'])
    expect(registry.listUsable(TaskHeader).map((usable) => usable.componentId)).toEqual(['core.task-header'])
  })
})

describe('core’s task header main part', () => {
  it('is registered once, for TaskHeader, and fits it with all three capabilities', () => {
    const [only, ...others] = registered()

    expect(others).toHaveLength(1)
    expect(only?.contract).toBe(TaskHeader)
    expect(checkComponentCompatibility(TaskHeader, only!.implementation)).toEqual({
      compatible: true,
      issues: [],
      capabilities: ['shows-title', 'shows-status', 'shows-meta'],
      missingCapabilities: [],
      customCapabilities: [],
    })
  })

  it('is core’s default, which renders and is always the fallback', () => {
    const registry = createCoreComponentRegistry()

    expect(registry.get('core.task-header')).toMatchObject({
      componentId: 'core.task-header',
      extensionId: null,
      compatible: true,
      component: registered()[0]?.implementation.component,
    })
    const resolution = resolveComponent(registry, TaskHeader)
    if (resolution.status !== 'resolved') throw new Error('expected core’s default')
    expect(resolution.component.componentId).toBe('core.task-header')
    expect(resolution.fallback).toBe(resolution.component)
  })

  it('keeps core’s id: registered before the extension host, it cannot be taken by an extension', () => {
    const registry = createCoreComponentRegistry()
    const components = registry.forExtension(fakeScope('cezar.task').scope)
    const implementation = registered()[0]!.implementation

    expect(() => components.provide(TaskHeader, { ...implementation, title: 'Impostor header' })).toThrow(
      /already provided by core/,
    )
    expect(registry.get('core.task-header')?.extensionId).toBeNull()
  })
})
