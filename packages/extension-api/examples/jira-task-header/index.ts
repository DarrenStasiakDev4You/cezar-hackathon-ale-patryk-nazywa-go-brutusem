import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'

import { defineExtension, TaskHeader, type ComponentProps, type TaskHeaderActionState } from '@open-mercato/cezar-extension-api'

import { draftJiraIssue } from './draft.ts'

type Props = ComponentProps<typeof TaskHeader>
type ElementRef = { focus(): void; select(): void }

const STATUS_COLORS: Record<string, string> = {
  success: '#2f9e62',
  pending: '#c58a15',
  danger: '#d04b4b',
  violet: '#8b67c7',
  neutral: 'GrayText',
}

/** The example keys its state by task because the host keeps a healthy part mounted between tasks. */
function JiraTaskHeader(props: Props) {
  return h(JiraTaskHeaderRow, { ...props, key: props.task.taskId })
}

function JiraTaskHeaderRow(props: Props) {
  const [open, setOpen] = useState(false)
  const [openSeq, setOpenSeq] = useState(0)
  const [summaryEdit, setSummaryEdit] = useState<string | null>(null)
  const [descriptionEdit, setDescriptionEdit] = useState<string | null>(null)
  const [copied, setCopied] = useState<'summary' | 'description' | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)
  const triggerRef = useRef<ElementRef | null>(null)
  const panelRef = useRef<{ contains(target: unknown): boolean } | null>(null)
  const summaryRef = useRef<ElementRef | null>(null)
  const descriptionRef = useRef<ElementRef | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draft = useMemo(() => (open ? draftJiraIssue(props) : null), [open, openSeq])
  const panelId = `jira-issue-draft-${props.task.taskId}`

  const resetDraft = () => {
    setSummaryEdit(null)
    setDescriptionEdit(null)
    setCopied(null)
    setCopyFailed(false)
    if (copiedTimer.current !== null) {
      clearTimeout(copiedTimer.current)
      copiedTimer.current = null
    }
  }

  const close = (returnFocus: boolean) => {
    resetDraft()
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    summaryRef.current?.focus()
    const documentLike = (globalThis as {
      document?: {
        addEventListener(type: string, listener: (event: { target: unknown }) => void): void
        removeEventListener(type: string, listener: (event: { target: unknown }) => void): void
      }
    }).document
    if (documentLike === undefined) return
    const onPointerDown = (event: { target: unknown }) => {
      if (!panelRef.current?.contains(event.target)) close(false)
    }
    documentLike.addEventListener('pointerdown', onPointerDown)
    return () => documentLike.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
    },
    [],
  )

  const copy = (field: 'summary' | 'description', value: string) => {
    setCopied(null)
    setCopyFailed(false)
    const clipboard = (globalThis as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }).navigator?.clipboard
    if (clipboard === undefined) {
      copyFailure(field)
      return
    }
    void Promise.resolve()
      .then(() => clipboard.writeText(value))
      .then(
        () => {
          setCopied(field)
          if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
          copiedTimer.current = setTimeout(() => {
            copiedTimer.current = null
            setCopied(null)
          }, 2_000)
        },
        () => copyFailure(field),
      )
  }

  const copyFailure = (field: 'summary' | 'description') => {
    setCopyFailed(true)
    if (field === 'summary') summaryRef.current?.select()
    else descriptionRef.current?.select()
  }

  const rename = () => {
    if (open) close(true)
    props.onRename()
  }

  const title = props.task.title || `Cezar task ${props.task.taskId}`
  const statusColor = STATUS_COLORS[props.attention.tone] ?? STATUS_COLORS.neutral

  return h(
    'div',
    { 'data-example': 'jira-task-header', style: { position: 'relative', minWidth: 0, minHeight: 30, font: 'inherit' } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, minHeight: 30 } },
      h('strong', { title: props.task.prompt, style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
      h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 } },
        h('span', { 'aria-hidden': true, style: { width: 7, height: 7, borderRadius: '50%', background: statusColor } }),
        `${props.attention.label}${props.attention.queuePosition === undefined ? '' : ` #${props.attention.queuePosition}`}`,
      ),
      h(
        'button',
        { type: 'button', 'aria-label': 'Rename task', onClick: rename, style: buttonStyle },
        '✎',
      ),
      h(
        'span',
        { style: { display: 'flex', gap: 4, marginLeft: 'auto', flexShrink: 0 } },
        action('Continue', props.actions.continue, props.onContinue),
        action('Stop', props.actions.stop, props.onStop),
        action(props.task.archived ? 'Unarchive' : 'Archive', props.actions.archive, props.onArchive),
        props.actions.chooseEngine.available
          ? action('Choose engine', props.actions.chooseEngine, props.onChooseEngine)
          : null,
        h(
          'button',
          {
            ref: triggerRef,
            type: 'button',
            'aria-expanded': open,
            'aria-controls': panelId,
            onClick: () => {
              if (open) close(true)
              else {
                resetDraft()
                setOpenSeq((value) => value + 1)
                setOpen(true)
              }
            },
            style: buttonStyle,
          },
          'Draft Jira issue',
        ),
      ),
    ),
    open && draft
      ? h(
          'div',
          {
            ref: panelRef,
            id: panelId,
            role: 'dialog',
            'aria-label': 'Jira issue draft',
            style: {
              position: 'absolute',
              top: '100%',
              right: 0,
              zIndex: 30,
              width: 'min(28rem, 100%)',
              boxSizing: 'border-box',
              padding: 10,
              border: '1px solid GrayText',
              background: 'Canvas',
              color: 'CanvasText',
              font: 'inherit',
            },
            onKeyDown: (event: { key: string }) => {
              if (event.key === 'Escape') close(true)
            },
          },
          h('label', { style: { display: 'block', fontWeight: 600 } }, 'Summary'),
          h(
            'div',
            { style: { display: 'flex', gap: 4, marginTop: 4 } },
            h('input', {
              ref: summaryRef,
              'aria-label': 'Summary',
              value: summaryEdit ?? draft.summary,
              maxLength: 255,
              onChange: (event: { currentTarget: unknown }) => setSummaryEdit((event.currentTarget as { value: string }).value),
              style: { minWidth: 0, flex: 1, font: 'inherit' },
            }),
            copyButton('summary', copied === 'summary', () => copy('summary', summaryEdit ?? draft.summary)),
          ),
          h('label', { style: { display: 'block', marginTop: 8, fontWeight: 600 } }, 'Description'),
          h(
            'div',
            { style: { display: 'flex', gap: 4, marginTop: 4 } },
            h('textarea', {
              ref: descriptionRef,
              'aria-label': 'Description',
              rows: 8,
              value: descriptionEdit ?? draft.description,
              onChange: (event: { currentTarget: unknown }) => setDescriptionEdit((event.currentTarget as { value: string }).value),
              style: { minWidth: 0, flex: 1, font: 'inherit' },
            }),
            copyButton('description', copied === 'description', () => copy('description', descriptionEdit ?? draft.description)),
          ),
          h('p', { style: { margin: '8px 0', color: 'GrayText', fontSize: 12 } }, 'Copies to the clipboard. Nothing is sent to Jira.'),
          copyFailed
            ? h('p', { role: 'status', style: { margin: '8px 0', color: 'GrayText', fontSize: 12 } }, 'Copy failed. Select the text and copy it yourself.')
            : null,
          copied ? h('div', { 'aria-live': 'polite', style: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' } }, `${copied === 'summary' ? 'Summary' : 'Description'} copied`) : null,
          h('button', { type: 'button', onClick: () => close(true), style: buttonStyle }, 'Close'),
        )
      : null,
  )
}

const buttonStyle = { font: 'inherit', fontSize: 12, padding: '2px 8px', flexShrink: 0 }

function action(label: string, state: TaskHeaderActionState, onPress: () => void) {
  if (!state.available) return null
  return h(
    'button',
    { type: 'button', disabled: !state.enabled, title: state.reason, onClick: onPress, style: buttonStyle },
    label,
  )
}

function copyButton(field: 'summary' | 'description', isCopied: boolean, onClick: () => void) {
  const label = field === 'summary' ? 'Copy summary' : 'Copy description'
  return h('button', { type: 'button', onClick, style: buttonStyle }, isCopied ? 'Copied' : label)
}

export default defineExtension({
  manifest: {
    id: 'example.jira-header',
    name: 'Jira task header (example)',
    version: '1.0.0',
    engines: { cezar: '>=0.11.2' },
  },
  activate(context) {
    context.components.provide(TaskHeader, {
      id: 'example.jira-header.row',
      title: 'Row with a Jira draft',
      capabilities: ['shows-title', 'shows-status', 'offers-continue', 'offers-stop', 'offers-archive'],
      component: JiraTaskHeader,
    })
  },
})
