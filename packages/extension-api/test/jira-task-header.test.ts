import { describe, expect, it, vi } from 'vitest'

import {
  checkComponentCompatibility,
  TaskHeader,
  validateManifest,
  type ComponentProps,
} from '@open-mercato/cezar-extension-api'

import jiraHeader from '../examples/jira-task-header/index.ts'
import { draftJiraIssue } from '../examples/jira-task-header/draft.ts'
import { JIRA_DESCRIPTION_MAX, JIRA_SUMMARY_MAX } from '../examples/jira-task-header/draft.ts'
import { createFakeContext } from './fake-context.ts'

type Props = ComponentProps<typeof TaskHeader>

const idle = { available: false, enabled: false, pending: false }
const ready = { available: true, enabled: true, pending: false }

function props(extra: Partial<Props> = {}): Props {
  return {
    task: { taskId: 'r1', projectId: 'acme', title: 'Do the thing', prompt: 'Summarize it.', status: 'done', archived: false },
    attention: { label: 'done', tone: 'success', pulse: false },
    engine: { runner: 'claude', model: 'opus' },
    meta: {
      workflow: 'quick-task',
      branch: 'cez/r1',
      diff: { added: 12, removed: 3, files: 1, repointed: true },
      references: [
        { kind: 'pr', number: 534, url: 'https://github.com/o/r/pull/534', status: 'ready', lookup: 'ready' },
        { kind: 'issue', number: 544, url: 'https://github.com/o/r/issues/544', status: 'open', lookup: 'ready' },
      ],
      usage: { inputTokens: 100, outputTokens: 200, costUsd: 0.04 },
    },
    actions: { continue: ready, stop: idle, archive: ready, resolveConflicts: idle, chooseEngine: ready },
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

async function provided() {
  const fake = createFakeContext(jiraHeader.manifest)
  await jiraHeader.activate(fake.context)
  const row = fake.components.get('example.jira-header.row')
  if (row === undefined) throw new Error('example.jira-header.row was not provided')
  return { fake, row }
}

describe('the Jira task header draft', () => {
  it('writes a full model in the documented order', () => {
    const result = draftJiraIssue(props())

    expect(result.description).toBe(
      [
        'Drafted from Cezar task r1 in project acme.',
        '',
        'Status: done',
        'Agent: claude · opus',
        'Workflow: quick-task',
        'Branch: cez/r1',
        'Changes: +12 −3 across 1 file, measured against a branch the agent checked out',
        'Pull request #534 (ready): https://github.com/o/r/pull/534',
        'Issue #544 (open): https://github.com/o/r/issues/544',
        '',
        'Original request:',
        'Summarize it.',
      ].join('\n'),
    )
  })

  it('omits absent facts without leaving blank labels or a project fragment', () => {
    const result = draftJiraIssue(
      props({
        task: { taskId: 'r2', projectId: '', title: '  ', prompt: 'Minimal', status: 'done', archived: false },
        engine: { runner: 'codex', model: 'auto' },
        meta: { workflow: '' },
      }),
    )

    expect(result.description).toBe(['Drafted from Cezar task r2.', '', 'Status: done', 'Agent: codex · auto', '', 'Original request:', 'Minimal'].join('\n'))
    expect(result.description).not.toContain('Branch:')
    expect(result.description).not.toContain(' in project')
  })

  it('collapses and safely truncates the summary', () => {
    const title = `${'x'.repeat(254)}😀`
    const result = draftJiraIssue(props({ task: { ...props().task, title: `  hello\n\tworld  ` } }))
    expect(result.summary).toBe('hello world')

    const long = draftJiraIssue(props({ task: { ...props().task, title } })).summary
    expect(long.length).toBeLessThanOrEqual(JIRA_SUMMARY_MAX)
    expect(long.endsWith('…')).toBe(true)
    expect([...long].at(-2)).not.toBe('\ud83d')
    expect(draftJiraIssue(props({ task: { ...props().task, title: ' \n\t' } })).summary).toBe('Cezar task r1')
  })

  it('renders reference variants and only documented statuses', () => {
    const result = draftJiraIssue(
      props({
        meta: {
          workflow: 'w',
          references: [
            { kind: 'pr', url: 'https://example.test/no-number' },
            { kind: 'pr', number: 2 },
            { kind: 'pr', number: 3, status: 'checks-failing', lookup: 'unavailable' },
            { kind: 'pr', number: 4, status: 'ready', lookup: 'loading' },
            { kind: 'pr', number: 5, status: 'ready', lookup: 'unknown' },
            { kind: 'pr', number: 6, status: 'future-status', lookup: 'ready' },
          ],
        },
      }),
    )
    expect(result.description).toContain('Pull request: https://example.test/no-number')
    expect(result.description).toContain('Pull request #2')
    expect(result.description).toContain('Pull request #3 (last known: checks-failing)')
    expect(result.description).not.toContain('#4 (ready)')
    expect(result.description).not.toContain('#5 (ready)')
    expect(result.description).not.toContain('future-status')
  })

  it('cuts an oversized prompt and reference list while preserving fixed facts', () => {
    const promptResult = draftJiraIssue(props({ task: { ...props().task, prompt: 'p'.repeat(50_000) } }))
    expect(promptResult.description.length).toBeLessThanOrEqual(JIRA_DESCRIPTION_MAX)
    expect(promptResult.description).toContain('Changes: +12 −3 across 1 file')
    expect(promptResult.description).toContain('… (cut to fit Jira\'s description limit)')

    const references = Array.from({ length: 1_000 }, (_, index) => ({ kind: 'pr' as const, number: index + 1, url: `https://example.test/${'x'.repeat(50)}` }))
    const referenceResult = draftJiraIssue(props({ meta: { workflow: 'w', references } }))
    expect(referenceResult.description.length).toBeLessThanOrEqual(JIRA_DESCRIPTION_MAX)
    expect(referenceResult.description).toMatch(/… and \d+ more references$/)
    expect(referenceResult.description).not.toContain('Original request:')
  })

  it('is deterministic and excludes account and usage', () => {
    const given = props({ engine: { runner: 'claude', model: 'opus', account: 'secret-account', identity: 'anthropic/opus' } })
    const first = draftJiraIssue(given)
    expect(first).toEqual(draftJiraIssue(given))
    expect(first.description).not.toContain('secret-account')
    expect(first.description).not.toContain('100')
    expect(first.description).not.toContain('$0.04')
  })
})

describe('the Jira task header example', () => {
  it('is a valid extension and provides exactly its task header row', async () => {
    expect(validateManifest(jiraHeader.manifest)).toEqual([])
    const { fake, row } = await provided()
    expect([...fake.components.keys()]).toEqual(['example.jira-header.row'])
    expect(row.contract).toEqual(TaskHeader)
    expect(row.implementation.title).toBe('Row with a Jira draft')
  })

  it('declares the complete action takeover without meta', async () => {
    const { row } = await provided()
    expect(checkComponentCompatibility(TaskHeader, row.implementation, row.contract)).toEqual({
      compatible: true,
      issues: [],
      capabilities: ['shows-title', 'shows-status', 'offers-continue', 'offers-stop', 'offers-archive'],
      customCapabilities: [],
      missingCapabilities: [],
    })
  })

})
