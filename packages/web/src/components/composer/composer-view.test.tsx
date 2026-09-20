import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ComposerView } from './composer-view'

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
Element.prototype.scrollIntoView = vi.fn()

afterEach(cleanup)

describe('ComposerView', () => {
  it('renders from props without a query provider and sends through its intent', () => {
    const onSend = vi.fn()
    const onValueChange = vi.fn()
    render(
      <ComposerView
        value="hello"
        onValueChange={onValueChange}
        attachments={[]}
        onFiles={vi.fn()}
        onRemove={vi.fn()}
        sendEnabled
        onSend={onSend}
      />,
    )

    fireEvent.click(screen.getByLabelText('Send'))
    expect(onSend).toHaveBeenCalledOnce()
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('requests skills once when the first slash token opens', () => {
    const onRequest = vi.fn()
    const onValueChange = vi.fn()
    render(
      <ComposerView
        value=""
        onValueChange={onValueChange}
        attachments={[]}
        onFiles={vi.fn()}
        onRemove={vi.fn()}
        sendEnabled={false}
        onSend={vi.fn()}
        onRequest={onRequest}
        skills={[{ name: 'om-fix', project: true }]}
      />,
    )

    const textarea = screen.getByLabelText('Reply to the agent')
    fireEvent.change(textarea, { target: { value: '/' } })
    fireEvent.select(textarea)
    fireEvent.select(textarea)
    expect(onRequest).toHaveBeenCalledWith('skills')
    expect(onRequest).toHaveBeenCalledOnce()
  })

  it('passes pasted files with the clipboard source', () => {
    const onFiles = vi.fn()
    render(
      <ComposerView
        value=""
        onValueChange={vi.fn()}
        attachments={[]}
        onFiles={onFiles}
        onRemove={vi.fn()}
        sendEnabled={false}
        onSend={vi.fn()}
      />,
    )
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    fireEvent.paste(screen.getByLabelText('Reply to the agent'), {
      clipboardData: { items: [{ kind: 'file', getAsFile: () => file }] },
    })
    expect(onFiles).toHaveBeenCalledWith([file], 'clipboard')
  })
})
