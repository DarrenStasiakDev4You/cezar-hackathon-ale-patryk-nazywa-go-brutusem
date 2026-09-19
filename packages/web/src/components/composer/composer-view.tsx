import { ArrowUpIcon, CheckIcon, MicIcon, PaperclipIcon, XIcon } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'

import { Button } from '@/components/ui/button'
import { Command, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { isSubmitShortcut } from '@/lib/use-submit-shortcut'
import { cn } from '@/lib/utils'

import { applyCompletion, detectTrigger, type TriggerState } from './composer-text'
import { type PendingAttachment } from './composer-attachments'
import { formatElapsed, useDictation } from './dictation'

export interface ComposerViewSkill {
  readonly name: string
  readonly description?: string
  readonly project?: boolean
  readonly uses?: number
}

export interface ComposerViewHandle {
  insertAtCaret: (snippet: string) => void
}

export interface ComposerViewProps {
  readonly value: string
  readonly onValueChange: (text: string) => void
  readonly attachments: readonly PendingAttachment[]
  readonly onFiles: (files: readonly File[], source: 'file' | 'clipboard') => void
  readonly onRemove: (key: string) => void
  readonly sendEnabled: boolean
  readonly onSend: () => void
  readonly disabled?: boolean
  readonly disabledReason?: string
  readonly allowEmptySubmit?: boolean
  readonly placeholder?: string
  readonly ariaLabel?: string
  readonly sendAriaLabel?: string
  readonly autoFocus?: boolean
  readonly accept?: string
  readonly autocompleteSkills?: boolean
  readonly skills?: readonly ComposerViewSkill[]
  readonly mentions?: readonly string[]
  readonly onRequest?: (kind: 'skills' | 'files') => void
  readonly onSkillPicked?: (name: string) => void
  readonly footerStart?: ReactNode
  readonly footerEnd?: ReactNode
  readonly ref?: Ref<ComposerViewHandle>
}

interface MenuCandidate {
  readonly value: string
  readonly insert: string
  readonly label: string
  readonly description?: string
  readonly emphasized: boolean
}

const fileKey = (attachment: PendingAttachment, index: number) => attachment.key ?? attachment.id ?? `${attachment.name}-${index}`

/**
 * The prop-only presentation of a composer. It owns only ephemeral view state (caret, open menu,
 * dictation and textarea sizing); draft, query, delivery and attachment persistence belong to its
 * host. In particular this file intentionally imports no API, query or draft-store module.
 */
export function ComposerView({
  value,
  onValueChange,
  attachments,
  onFiles,
  onRemove,
  sendEnabled,
  onSend,
  disabled = false,
  disabledReason = 'Session closed — Continue to reopen.',
  allowEmptySubmit = false,
  placeholder = 'Reply — / for skills, @ for files…',
  ariaLabel = 'Reply to the agent',
  sendAriaLabel = 'Send',
  autoFocus = false,
  accept = 'image/*,application/pdf,text/plain,text/markdown,.pdf,.txt,.md,.markdown,.log',
  autocompleteSkills = true,
  skills = [],
  mentions = [],
  onRequest,
  onSkillPicked,
  footerStart,
  footerEnd,
  ref,
}: ComposerViewProps) {
  const [trigger, setTrigger] = useState<TriggerState | null>(null)
  const [menuValue, setMenuValue] = useState('')
  const [requested, setRequested] = useState<ReadonlySet<string>>(() => new Set())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const pendingCaretRef = useRef<number | null>(null)
  const menuItemRefs = useRef<Map<string, HTMLElement>>(new Map())
  const dictation = useDictation(() => {})

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [])

  useImperativeHandle(ref, () => ({
    insertAtCaret: (snippet) => {
      const element = textareaRef.current
      const caret = element?.selectionStart ?? value.length
      const result = `${value.slice(0, caret)}${snippet}${value.slice(caret)}`
      onValueChange(result)
      pendingCaretRef.current = caret + snippet.length
      element?.focus()
    },
  }), [onValueChange, value])

  const syncTrigger = useCallback(() => {
    const element = textareaRef.current
    if (!element || disabled) {
      setTrigger(null)
      return
    }
    const next = detectTrigger(element.value, element.selectionStart ?? element.value.length)
    if (next?.trigger === '/' && !autocompleteSkills) return setTrigger(null)
    if (next?.trigger === '@' && onRequest === undefined) return setTrigger(null)
    if (next && !requested.has(next.trigger === '/' ? 'skills' : 'files')) {
      const kind = next.trigger === '/' ? 'skills' : 'files'
      setRequested((current) => new Set(current).add(kind))
      onRequest?.(kind)
    }
    setTrigger(next)
  }, [autocompleteSkills, disabled, onRequest, requested])

  const candidates = useMemo((): MenuCandidate[] => {
    if (!trigger) return []
    if (trigger.trigger === '/') {
      return skills
        .filter((skill) => fuzzyMatch(skill.name, trigger.query))
        .map((skill) => ({
          value: skill.name,
          insert: skill.name,
          label: skill.name,
          description: skill.description,
          emphasized: skill.project ?? false,
        }))
    }
    return mentions
      .filter((path) => fuzzyMatch(path, trigger.query))
      .map((path) => ({ value: path, insert: path, label: path, emphasized: false }))
  }, [mentions, skills, trigger])

  const activeValue = candidates.some((candidate) => candidate.value === menuValue)
    ? menuValue
    : candidates[0]?.value
  const menuOpen = trigger !== null
  const closeMenu = useCallback(() => setTrigger(null), [])

  const pick = useCallback((candidate: MenuCandidate) => {
    const element = textareaRef.current
    if (!element || !trigger) return
    const caret = element.selectionStart ?? element.value.length
    const next = applyCompletion(element.value, trigger, caret, candidate.insert)
    onValueChange(next.text)
    pendingCaretRef.current = next.caret
    setTrigger(null)
    if (trigger.trigger === '/') onSkillPicked?.(candidate.insert)
    element.focus()
  }, [onSkillPicked, onValueChange, trigger])

  useEffect(() => {
    if (!menuOpen || activeValue == null) return
    menuItemRefs.current.get(activeValue)?.scrollIntoView({ block: 'nearest' })
  }, [activeValue, menuOpen])

  useLayoutEffect(() => {
    const caret = pendingCaretRef.current
    const element = textareaRef.current
    if (caret !== null && element) {
      element.setSelectionRange(caret, caret)
      pendingCaretRef.current = null
    }
  }, [value])

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`
  }, [value])

  const submit = useCallback(() => {
    if (!sendEnabled || disabled) return
    if (!allowEmptySubmit && value.trim() === '' && attachments.length === 0) return
    onSend()
  }, [allowEmptySubmit, attachments.length, disabled, onSend, sendEnabled, value])

  const onPaste = (event: ClipboardEvent) => {
    const files = [...(event.clipboardData?.items ?? [])]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return
    event.preventDefault()
    onFiles(files, 'clipboard')
  }

  const onDrop = (event: DragEvent) => {
    const files = [...(event.dataTransfer?.files ?? [])]
    if (files.length === 0) return
    event.preventDefault()
    onFiles(files, 'file')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (candidates.length === 0) return
        const at = candidates.findIndex((candidate) => candidate.value === activeValue)
        const delta = event.key === 'ArrowDown' ? 1 : -1
        setMenuValue(candidates[(at + delta + candidates.length) % candidates.length]!.value)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu()
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
        const candidate = candidates.find((item) => item.value === activeValue)
        if (candidate) {
          event.preventDefault()
          pick(candidate)
          return
        }
        closeMenu()
      }
    }
    if (isSubmitShortcut({
      key: event.key,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      repeat: event.repeat,
      isComposing: event.nativeEvent.isComposing,
    })) {
      event.preventDefault()
      submit()
    }
  }

  const insertTranscript = (alsoSend: boolean) => {
    const transcript = dictation.finish()
    if (!transcript) return
    const merged = value.trim() === '' ? transcript : `${value.replace(/\s*$/, '')} ${transcript}`
    onValueChange(merged)
    if (alsoSend) onSend()
    else {
      pendingCaretRef.current = merged.length
      textareaRef.current?.focus()
    }
  }

  return (
    <Popover open={menuOpen} onOpenChange={(open) => (open ? undefined : closeMenu())}>
      <PopoverAnchor asChild>
        <div
          ref={rootRef}
          data-slot="composer"
          data-disabled={disabled || undefined}
          onDrop={onDrop}
          onDragOver={(event) => event.preventDefault()}
          className={cn(
            'rounded-xl border border-border bg-card shadow-xs transition-[border-color,box-shadow]',
            'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/15',
            disabled && 'opacity-80',
          )}
        >
          {attachments.length > 0 ? (
            <div data-slot="composer-thumbs" className="flex flex-wrap items-center gap-2 px-4 pt-3">
              {attachments.map((attachment, index) => (
                <button
                  key={fileKey(attachment, index)}
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  title="Click to remove"
                  className={cn(
                    'group relative overflow-hidden rounded-md border border-border',
                    attachment.isImage
                      ? 'size-12'
                      : 'flex h-12 max-w-[200px] items-center gap-1.5 bg-muted/40 px-2.5 text-xs text-muted-foreground',
                  )}
                  onClick={() => onRemove(fileKey(attachment, index))}
                >
                  {attachment.isImage ? <img src={attachment.preview} alt="" className="size-full object-cover" /> : <><PaperclipIcon aria-hidden="true" className="size-3.5 shrink-0" /><span className="truncate">{attachment.name}</span></>}
                  <span className="absolute inset-0 hidden items-center justify-center bg-background/70 group-hover:flex group-focus-visible:flex"><XIcon aria-hidden="true" className="size-4" /></span>
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            disabled={disabled}
            aria-label={ariaLabel}
            placeholder={disabled ? disabledReason : placeholder}
            className="block max-h-[220px] min-h-11 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-base leading-normal outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:min-h-[54px] md:px-4 md:pt-3 md:text-sm"
            onChange={(event) => { onValueChange(event.target.value); syncTrigger() }}
            onKeyDown={onKeyDown}
            onSelect={syncTrigger}
            onPaste={onPaste}
          />
          {dictation.recording ? (
            <div data-slot="dictation-overlay" role="status" aria-label="Dictation in progress" className="flex items-center gap-2.5 rounded-b-xl border-t border-border bg-muted/60 px-3 py-2">
              <span aria-hidden="true" className="size-2 flex-none animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
              <span data-slot="dictation-timer" className="text-xs font-medium text-muted-foreground tabular-nums">{formatElapsed(dictation.recording.startedAt, Date.now())}</span>
              <span data-slot="dictation-transcript" aria-live="polite" className="min-w-0 flex-1 truncate text-sm text-foreground">{dictation.recording.transcript || <span className="text-muted-foreground">Listening…</span>}</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel dictation" className="size-8 text-muted-foreground" onClick={dictation.cancel}><XIcon aria-hidden="true" /></Button>
              <Button type="button" variant="outline" size="icon-sm" aria-label="Insert transcription" className="size-8" onClick={() => insertTranscript(false)}><CheckIcon aria-hidden="true" /></Button>
              <Button type="button" size="icon-sm" aria-label="Insert transcription and send" className="size-8" onClick={() => insertTranscript(true)}><ArrowUpIcon aria-hidden="true" /></Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1 gap-y-1 px-1.5 pt-1 pb-1.5 md:gap-y-1.5 md:px-2 md:pt-1.5 md:pb-2">
              <div data-slot="composer-footer-start" className="flex min-w-0 flex-wrap items-center gap-1">
                <AttachButton disabled={disabled} accept={accept} onFiles={onFiles} />
                {footerStart}
              </div>
              <div className="ml-auto flex items-center gap-1">
                {dictation.supported ? <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label="Start dictation" title="Dictation" className="h-8 gap-1.5 px-2.5 text-xs font-medium text-muted-foreground" onClick={dictation.start}><MicIcon aria-hidden="true" className="size-3.5" />Dictation</Button> : null}
                {footerEnd ? <div data-slot="composer-footer-end" className="flex items-center gap-1.5">{footerEnd}</div> : null}
                <Button type="button" size="icon-sm" aria-label={sendAriaLabel} disabled={disabled || !sendEnabled} className="size-8" onClick={submit}><ArrowUpIcon aria-hidden="true" /></Button>
              </div>
            </div>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-80 max-w-[calc(100vw-2rem)] p-0" onOpenAutoFocus={(event) => event.preventDefault()} onInteractOutside={(event) => { if (rootRef.current?.contains(event.target as Node)) event.preventDefault() }}>
        <Command shouldFilter={false} value={activeValue ?? ''} onValueChange={setMenuValue}>
          <CommandList data-slot="composer-menu" data-trigger={trigger?.trigger} className="max-h-[min(16rem,var(--radix-popover-content-available-height))] p-1">
            {candidates.length === 0 ? <p className="px-3 py-4 text-center text-xs text-muted-foreground">{trigger?.trigger === '@' ? 'No files seen in this session yet — full file search arrives with the Files tab.' : 'No matching skills.'}</p> : candidates.map((candidate) => (
              <CommandItem key={candidate.value} ref={(element) => { if (element) menuItemRefs.current.set(candidate.value, element); else menuItemRefs.current.delete(candidate.value) }} value={candidate.value} data-slot="composer-menu-item" data-emphasized={candidate.emphasized || undefined} onSelect={() => pick(candidate)}>
                <span className={cn('shrink-0 truncate', candidate.emphasized && 'font-semibold', trigger?.trigger === '@' && 'font-mono text-xs')}>{candidate.label}</span>
                {candidate.description ? <span className="min-w-0 flex-1 truncate text-xs text-soft-foreground">{candidate.description}</span> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function fuzzyMatch(candidate: string, query: string): boolean {
  if (query === '') return true
  let at = 0
  for (const char of query.toLowerCase()) {
    at = candidate.toLowerCase().indexOf(char, at)
    if (at === -1) return false
    at += 1
  }
  return true
}

function AttachButton({ disabled, accept, onFiles }: { disabled: boolean; accept: string; onFiles: (files: readonly File[], source: 'file' | 'clipboard') => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return <>
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Attach files" title="Attach an image, PDF, TXT or MD file (or paste a screenshot)" disabled={disabled} className="size-8 text-muted-foreground" onClick={() => inputRef.current?.click()}><PaperclipIcon aria-hidden="true" className="size-[15px]" /></Button>
    <input ref={inputRef} type="file" accept={accept} multiple className="hidden" aria-hidden="true" tabIndex={-1} onChange={(event) => { onFiles([...(event.target.files ?? [])], 'file'); event.target.value = '' }} />
  </>
}
