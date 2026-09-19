import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TaskComposerProps } from '@open-mercato/cezar-extension-api'
import { CoreTaskComposer } from './core-task-composer'

vi.stubGlobal('ResizeObserver', class { observe() {}; unobserve() {}; disconnect() {} })
Element.prototype.scrollIntoView = vi.fn()
afterEach(cleanup)

const props = (): TaskComposerProps => ({
  task: { taskId: 'task-1', projectId: 'project-1' },
  draft: { text: 'hello', attachments: [] },
  status: { mode: 'reply', placeholder: 'Reply', submitLabel: 'Send' },
  availability: { enabled: true },
  actions: {
    submit: { available: true, enabled: true, pending: false },
    attach: { available: true, enabled: true, pending: false },
    chooseRunner: { available: true, enabled: true, pending: false },
    chooseModel: { available: true, enabled: true, pending: false },
  },
  engine: {
    runner: 'codex',
    model: 'auto',
    modelLabel: 'Auto',
    runnerChoices: [{ runner: 'codex', label: 'codex' }],
    modelChoices: [{ id: 'auto', label: 'Auto' }],
  },
  completions: { skills: { status: 'idle', items: [] }, files: { status: 'idle', items: [] } },
  limits: { maxAttachments: 4, maxAttachmentBytes: 5 * 1024 * 1024, accept: 'image/*' },
  onTextChange: vi.fn(),
  onSubmit: vi.fn(),
  onAttachFiles: vi.fn(),
  onRemoveAttachment: vi.fn(),
  onSelectRunner: vi.fn(),
  onSelectModel: vi.fn(),
  onRequestCompletions: vi.fn(),
  onUseSkill: vi.fn(),
  onNavigate: vi.fn(),
})

describe('CoreTaskComposer', () => {
  it('renders the controlled model and sends only through the contract intent', () => {
    const model = props()
    render(<CoreTaskComposer {...model} />)
    fireEvent.click(screen.getByLabelText('Send'))
    expect(model.onSubmit).toHaveBeenCalledOnce()
    expect((screen.getByLabelText('Reply to the agent') as HTMLTextAreaElement).value).toBe('hello')
  })
})
