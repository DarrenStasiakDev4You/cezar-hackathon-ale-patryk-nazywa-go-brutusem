import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  checkComponentCompatibility,
  TaskHeader,
  validateManifest,
  type ComponentProps,
} from '@open-mercato/cezar-extension-api'

import compact from '../examples/compact-task-header/index.ts'
import { createFakeContext } from './fake-context.ts'

// The brief's Definition of Done, on the package's side: a task header written against this
// package and `react` alone (spec `2026-09-19-task-header-contract`, Q9). The cockpit's own test
// (`packages/web/src/routes/task-thread/external-task-header.test.tsx`) uses it on the task page.

type Props = ComponentProps<typeof TaskHeader>

const idle = { available: false, enabled: false, pending: false }
const ready = { available: true, enabled: true, pending: false }

function props(extra: Partial<Props> = {}): Props {
  return {
    task: { taskId: 'r1', projectId: 'acme', title: 'Do the thing', prompt: 'Summarize it.', status: 'done', archived: false },
    attention: { label: 'done', tone: 'success', pulse: false },
    engine: { runner: 'claude', model: 'opus' },
    meta: { workflow: 'quick-task' },
    actions: { continue: ready, stop: idle, archive: ready, resolveConflicts: idle, chooseEngine: idle },
    onContinue: vi.fn(),
    onStop: vi.fn(),
    onArchive: vi.fn(),
    onRename: vi.fn(),
    onResolveConflicts: vi.fn(),
    onNavigate: vi.fn(),
    onChooseEngine: vi.fn(),
    ...extra,
  }
}

/** Every element in a tree, depth first. */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}

async function provided() {
  const fake = createFakeContext(compact.manifest)
  await compact.activate(fake.context)
  const row = fake.components.get('example.compact-header.row')
  if (row === undefined) throw new Error('example.compact-header.row was not provided')
  return { fake, row, render: row.implementation.component as unknown as (props: Props) => ReactElement }
}

describe('the compact task header example', () => {
  it('is a valid extension', () => {
    expect(compact.manifest.id).toBe('example.compact-header')
    expect(validateManifest(compact.manifest)).toEqual([])
  })

  it('provides example.compact-header.row against task.header@1', async () => {
    const { fake, row } = await provided()

    expect([...fake.components.keys()]).toEqual(['example.compact-header.row'])
    expect(row.contract).toEqual(TaskHeader)
    expect(row.implementation.title).toBe('Compact row')
  })

  it('takes over Continue, Stop and Archive, and the check sees it', async () => {
    const { row } = await provided()

    expect(checkComponentCompatibility(TaskHeader, row.implementation, row.contract)).toEqual({
      compatible: true,
      issues: [],
      capabilities: ['shows-title', 'shows-status', 'offers-continue', 'offers-stop', 'offers-archive'],
      missingCapabilities: [],
      customCapabilities: [],
    })
  })

  it('renders the title, the status and the engine, and each offered action calls its intent', async () => {
    const { render } = await provided()
    const given = props()
    const tree = elements(render(given))
    const text = (part: string) => tree.find((element) => element.props['data-part'] === part)?.props.children

    expect(tree.find((element) => element.type === 'strong')?.props.children).toBe('Do the thing')
    expect(text('status')).toBe('done')
    expect(text('engine')).toBe('claude · opus')

    const buttons = tree.filter((element) => element.type === 'button')
    expect(buttons.map((button) => button.props.children)).toEqual(['Continue', 'Archive'])
    for (const button of buttons) (button.props.onClick as () => void)()
    expect(given.onContinue).toHaveBeenCalledTimes(1)
    expect(given.onArchive).toHaveBeenCalledTimes(1)
    expect(given.onStop).not.toHaveBeenCalled()
  })

  it('offers Stop on an active task, and disables an action that cannot run', async () => {
    const { render } = await provided()
    const given = props({
      task: { taskId: 'r1', projectId: 'acme', title: 'Do the thing', prompt: 'Summarize it.', status: 'running', archived: false },
      actions: {
        continue: idle,
        stop: { available: true, enabled: false, pending: true },
        archive: idle,
        resolveConflicts: idle,
        chooseEngine: idle,
      },
    })
    const buttons = elements(render(given)).filter((element) => element.type === 'button')

    expect(buttons.map((button) => [button.props.children, button.props.disabled])).toEqual([['Stop', true]])
  })
})
