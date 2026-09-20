import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import config, { entryChunkGuard, entryChunkProblems, fixtureBundleGuard, reactRuntimeChunk, type BundledFile } from '../vite.config'

describe('production chunking', () => {
  it('keeps the coupled React runtime in a focused vendor chunk', () => {
    expect(reactRuntimeChunk.name).toBe('react-runtime')
    expect(reactRuntimeChunk.test.test('/repo/node_modules/react/index.js')).toBe(true)
    expect(reactRuntimeChunk.test.test('/repo/node_modules/react-dom/client.js')).toBe(true)
    expect(reactRuntimeChunk.test.test('/repo/node_modules/scheduler/index.js')).toBe(true)

    expect(reactRuntimeChunk.test.test('/repo/node_modules/react-router/index.js')).toBe(false)
    expect(reactRuntimeChunk.test.test('/repo/node_modules/@tanstack/react-query/index.js')).toBe(
      false,
    )
    expect(reactRuntimeChunk.test.test('/repo/web/app/src/routes.tsx')).toBe(false)
  })

  it('retains Vite default chunk-size warnings', () => {
    expect(config.build?.chunkSizeWarningLimit).toBeUndefined()
    expect(config.build?.rolldownOptions?.output).toMatchObject({
      codeSplitting: { groups: [reactRuntimeChunk] },
    })
  })
})

describe('workspace source aliases', () => {
  // The extension API is a linked workspace, so an import by name would resolve even without the
  // alias — through `node_modules` and its `exports` map. This is what pins it to the source file
  // that tsconfig.json `paths` names too.
  it('resolves the extension API to its source entry point', () => {
    expect(config.resolve?.alias).toMatchObject({
      '@open-mercato/cezar-extension-api': path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../extension-api/src/index.ts',
      ),
    })
  })
})

describe('the entry chunk check', () => {
  const MAIN = '/repo/packages/web/src/main.tsx'
  const CORE_COMPONENTS = '/repo/packages/web/src/component-registry/core-components.ts'
  const CORE_HEADER = '/repo/packages/web/src/routes/task-thread/core-task-header-main.tsx'
  const CORE_COMPOSER = '/repo/packages/web/src/routes/task-thread/core-task-composer.tsx'
  const COMPOSER_VIEW = '/repo/packages/web/src/components/composer/composer-view.tsx'
  const CHIP = '/repo/packages/web/src/components/reference-chip.tsx'
  const RUN_HEADER = '/repo/packages/web/src/routes/task-thread/run-header.tsx'
  const MARKDOWN = '/repo/packages/web/src/routes/task-thread/markdown.tsx'
  const STREAMDOWN = '/repo/node_modules/streamdown/dist/index.js'
  const chunk = (moduleIds: string[], extra: Partial<BundledFile> = {}): BundledFile => ({
    type: 'chunk',
    moduleIds,
    imports: [],
    ...extra,
  })
  /** The module graph's static edges; dynamic imports are simply not listed. */
  const edges =
    (graph: Record<string, string[]>) =>
    (moduleId: string): readonly string[] =>
      graph[moduleId] ?? []

  /** Today's shape: core's default in a shared chunk the entry imports, the run header lazy. */
  const bundle: Record<string, BundledFile> = {
    'assets/index.js': chunk([MAIN, CORE_COMPONENTS], { isEntry: true, imports: ['assets/provider.js'] }),
    'assets/provider.js': chunk([CORE_HEADER, CORE_COMPOSER, CHIP]),
    'assets/task-thread.js': chunk([RUN_HEADER, MARKDOWN, STREAMDOWN]),
    'assets/index.css': { type: 'asset' },
  }

  it('passes when core’s default loads with the entry and reaches nothing it must keep out', () => {
    const staticImportsOf = edges({
      [MAIN]: [CORE_COMPONENTS],
      [CORE_COMPONENTS]: [CORE_HEADER, CORE_COMPOSER],
      [CORE_HEADER]: [CHIP],
      [CORE_COMPOSER]: [COMPOSER_VIEW],
      [RUN_HEADER]: [MARKDOWN],
      [MARKDOWN]: [STREAMDOWN],
    })

    expect(entryChunkProblems({ bundle, staticImportsOf })).toEqual([])
  })

  it('fails when core’s default does not load with the entry', () => {
    const lazyOnly = { ...bundle, 'assets/provider.js': chunk([CHIP]), 'assets/core.js': chunk([CORE_HEADER]) }

    expect(entryChunkProblems({ bundle: lazyOnly, staticImportsOf: edges({}) })).toEqual([
      'no module matching /\\/src\\/routes\\/task-thread\\/core-task-header-main\\.tsx$/ loads with the entry',
      'no module matching /\\/src\\/routes\\/task-thread\\/core-task-composer\\.tsx$/ loads with the entry',
    ])
  })

  it('names the static path by which core’s default pulls in the markdown stack or the run header', () => {
    const staticImportsOf = edges({
      [CORE_HEADER]: [CHIP, RUN_HEADER],
      [CORE_COMPOSER]: [COMPOSER_VIEW],
      [CHIP]: [MARKDOWN],
      [MARKDOWN]: [STREAMDOWN],
    })

    expect(entryChunkProblems({ bundle, staticImportsOf })).toEqual([
      `${CORE_HEADER} pulls ${RUN_HEADER} into the first paint: ${CORE_HEADER} → ${RUN_HEADER}`,
      `${CORE_HEADER} pulls ${STREAMDOWN} into the first paint: ${CORE_HEADER} → ${CHIP} → ${MARKDOWN} → ${STREAMDOWN}`,
    ])
  })

  it('fails closed when the module graph cannot name core’s default’s imports', () => {
    const unreadable = (_moduleId: string): readonly string[] | undefined => undefined

    expect(entryChunkProblems({ bundle, staticImportsOf: unreadable })).toEqual([
      `the module graph names no static imports of ${CORE_HEADER}, so nothing it pulls in can be checked`,
      `the module graph names no static imports of ${CORE_COMPOSER}, so nothing it pulls in can be checked`,
    ])
    expect(entryChunkProblems({ bundle, staticImportsOf: edges({}) })).toHaveLength(2)
  })

  it('says so when the bundle has no entry chunk', () => {
    expect(entryChunkProblems({ bundle: { 'assets/a.js': chunk([CORE_HEADER]) }, staticImportsOf: edges({}) })).toEqual([
      'no entry chunk in the bundle',
    ])
  })

  it('runs as a build-only plugin of the production config', () => {
    const guard = entryChunkGuard()
    expect(guard.apply).toBe('build')
    expect(
      config.plugins
        ?.flat()
        .some((plugin) => plugin !== null && typeof plugin === 'object' && 'name' in plugin && plugin.name === guard.name),
    ).toBe(true)
  })

  it('keeps the configurable-header fixture out of release assets', () => {
    const guard = fixtureBundleGuard()
    expect(guard.apply).toBe('build')
    expect(
      config.plugins
        ?.flat()
        .some((plugin) => plugin !== null && typeof plugin === 'object' && 'name' in plugin && plugin.name === guard.name),
    ).toBe(true)
  })

  it('fails when a release asset contains the fixture id', () => {
    const guard = fixtureBundleGuard()
    const error = vi.fn()
    const generateBundle = typeof guard.generateBundle === 'function' ? guard.generateBundle : guard.generateBundle?.handler
    generateBundle?.call({ error } as never, {} as never, {
      'assets/leaked.js': { type: 'asset', source: 'fixture.configurable-header' },
    } as never, false)
    expect(error).toHaveBeenCalledWith('test fixture leaked into release assets: assets/leaked.js')
  })
})
