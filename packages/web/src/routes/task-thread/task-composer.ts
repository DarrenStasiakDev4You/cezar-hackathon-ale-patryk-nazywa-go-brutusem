import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { putUiState } from '@/api/client'
import { queryKeys, useSkills, useUiState } from '@/api/queries'
import type { ApiRun } from '@open-mercato/cezar-api-client'
import type {
  TaskComposerAttachment,
  TaskComposerFile,
  TaskComposerProps,
  TaskComposerSkill,
} from '@open-mercato/cezar-extension-api'
import { useNavigate, scopeTo, useActiveProjectId } from '@/lib/project-router'
import { isEditModeActive } from '@/components/edit-mode-interaction-guard'
import { toast } from '@/components/ui/toaster'
import { isEditableTarget } from '@/lib/use-command-shortcut'

import {
  fileToPendingAttachment,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  screenFiles,
  toAttachmentInput,
  type PendingAttachment,
} from '@/components/composer/composer-attachments'
import { bumpSkillUsage } from '@/lib/skills'
import { threadFilePaths, type ThreadState } from './thread-state'
import { useActiveProviderAvailability } from './active-provider'
import { useDeliverPrompt } from './deliver-prompt'
import { useDraft } from './thread-draft'
import type { ContinueAction } from './follow-up-engine'

export interface TaskComposerModelOptions {
  readonly continueAction: ContinueAction
  readonly thread: ThreadState
  /** Phase 2 supplies the hosted implementation's capability set. */
  readonly hosted?: { readonly attachesFiles: boolean; readonly choosesEngine: boolean }
}

const attachmentKey = (attachment: PendingAttachment, index: number) =>
  attachment.key ?? attachment.id ?? `${attachment.name}-${index}`

function composerAttachment(attachment: PendingAttachment, index: number): TaskComposerAttachment {
  return {
    key: attachmentKey(attachment, index),
    name: attachment.name,
    mediaType: attachment.mediaType,
    isImage: attachment.isImage,
    ...(attachment.preview ? { preview: attachment.preview } : {}),
  }
}

/**
 * The only reader behind the Task Composer contract. It turns core hooks and commands into a
 * serializable model plus void intents; the presentation does not need the query cache, draft
 * store, router or delivery endpoints.
 */
export function useTaskComposerModel(
  run: ApiRun,
  { continueAction, thread, hosted }: TaskComposerModelOptions,
): { readonly props: TaskComposerProps } {
  const navigate = useNavigate()
  const projectId = useActiveProjectId() ?? ''
  const draft = useDraft(run.id, 'composer')
  const deliverPrompt = useDeliverPrompt(run, continueAction)
  const activeProvider = useActiveProviderAvailability(run)
  const sessionOpen = run.status === 'running' || run.status === 'waiting'
  const queued = run.status === 'queued'
  const hasContinuation = !sessionOpen && !queued && continueAction.available
  const continuable = hasContinuation && continueAction.canContinue
  const activeProviderBlocked = sessionOpen && !activeProvider.usable
  const continuationProviderBlocked = hasContinuation && !continueAction.canContinue
  const providerBlocked = activeProviderBlocked || continuationProviderBlocked
  const providerReason = activeProviderBlocked ? activeProvider.reason : continueAction.reason
  const enabled = !providerBlocked && (sessionOpen || queued || continuable)

  const [pending, setPending] = useState(false)
  const [skillsWanted, setSkillsWanted] = useState(false)
  const [filesWanted, setFilesWanted] = useState(false)
  const skills = useSkills(skillsWanted)
  const uiState = useUiState()
  const draftRef = useRef(draft)
  draftRef.current = draft
  const pendingByTask = useRef(new Map<string, boolean>())
  pendingByTask.current.set(run.id, pending)

  const onTextChange = useCallback((text: string) => {
    if (!enabled) return
    draftRef.current.setText(text)
  }, [enabled])

  const onSubmit = useCallback(() => {
    const current = draftRef.current
    const text = current.text
    const images = current.images
    if (!enabled || pendingByTask.current.get(run.id) || (!continuable && text.trim() === '' && images.length === 0)) return
    setPending(true)
    pendingByTask.current.set(run.id, true)
    current.setText('')
    current.setImages([], 'submit')
    void current.submit(() => deliverPrompt(text, images.map(toAttachmentInput))).catch((error) => {
      draftRef.current.restoreTo(run.id, text, images)
      toast(error instanceof Error ? error.message : String(error), { tone: 'danger' })
    }).finally(() => {
      pendingByTask.current.delete(run.id)
      setPending(false)
    })
  }, [continuable, deliverPrompt, enabled, run.id])

  const sendQuickReply = useCallback((text: string) => {
    if (!enabled || pendingByTask.current.get(run.id)) return
    pendingByTask.current.set(run.id, true)
    setPending(true)
    void deliverPrompt(text, [])
      .catch((error) => toast(error instanceof Error ? error.message : String(error), { tone: 'danger' }))
      .finally(() => {
        pendingByTask.current.delete(run.id)
        setPending(false)
      })
  }, [deliverPrompt, enabled, run.id])

  // Alt+A / Alt+C are task accelerators, not draft edits. They deliberately bypass onSubmit so an
  // unsent draft remains untouched when a canned reply lands.
  useEffect(() => {
    if (!enabled) return
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.repeat || isEditableTarget(event.target) || isEditModeActive()) return
      const reply = event.code === 'KeyA' ? 'Yes, approved.' : event.code === 'KeyC' ? 'Continue.' : undefined
      if (!reply) return
      event.preventDefault()
      sendQuickReply(reply)
    }
    window.addEventListener('keydown', onWindowKeyDown)
    return () => window.removeEventListener('keydown', onWindowKeyDown)
  }, [enabled, sendQuickReply])

  const onAttachFiles = useCallback((files: readonly TaskComposerFile[], source: 'file' | 'clipboard') => {
    if (!enabled) return
    const intake = screenFiles(files, draftRef.current.images.length)
    for (const reason of intake.rejected) toast(reason, { tone: 'danger' })
    for (const file of intake.accepted) {
      void fileToPendingAttachment(file, source).then((attachment) => {
        const current = draftRef.current
        if (current.images.length >= MAX_ATTACHMENTS) return
        current.setImages([...current.images, attachment])
      }).catch((error) => toast(error instanceof Error ? error.message : String(error), { tone: 'danger' }))
    }
  }, [enabled])

  const onRemoveAttachment = useCallback((key: string) => {
    const current = draftRef.current
    current.setImages(current.images.filter((attachment, index) => attachmentKey(attachment, index) !== key))
  }, [])

  const onRequestCompletions = useCallback((kind: 'skills' | 'files') => {
    if (kind === 'skills') setSkillsWanted(true)
    else setFilesWanted(true)
  }, [])

  const onUseSkill = useCallback((name: string) => {
    if (uiState.data === undefined) return
    void putUiState({ skillUsage: bumpSkillUsage(uiState.data.skillUsage, name) })
      .then(() => undefined)
      .catch(() => {})
  }, [uiState.data])

  const onNavigate = useCallback((href: string) => {
    if (href === '/settings/agents#providers') {
      navigate(scopeTo(projectId, href))
      return
    }
    console.warn(`[TaskComposer] ignored unsupported navigation target: ${href}`)
  }, [navigate, projectId])

  const onSelectRunner = useCallback((runner: string, account?: string) => {
    if (!continuable || hosted?.choosesEngine === false || !continueAction.hasRunnerChoice) return
    const valid = continueAction.engine.runnerChoices.some((choice) =>
      choice.runner === runner && choice.account === account,
    )
    if (valid) continueAction.selectRunner(runner, account)
  }, [continueAction.engine.runnerChoices, continueAction.hasRunnerChoice, continueAction.selectRunner, continuable, hosted?.choosesEngine])

  const onSelectModel = useCallback((model: string) => {
    if (!continuable || hosted?.choosesEngine === false || continueAction.modelsLocked) return
    if (continueAction.engine.modelChoices.some((choice) => choice.id === model)) {
      continueAction.selectModel(model)
    }
  }, [continueAction.engine.modelChoices, continueAction.modelsLocked, continueAction.selectModel, continuable, hosted?.choosesEngine])

  const skillItems: readonly TaskComposerSkill[] = useMemo(() => (skills.data ?? []).map((skill) => ({
    key: `${skill.name}:${skill.path}`,
    name: skill.name,
    ...(skill.description ? { description: skill.description } : {}),
    project: skill.source !== 'global',
    uses: uiState.data?.skillUsage?.[skill.name] ?? 0,
  })), [skills.data, uiState.data?.skillUsage])

  const fileItems = useMemo(() => threadFilePaths(thread), [thread])
  const statusMode = sessionOpen ? 'reply' : queued ? 'queued' : continuable ? 'continue' : 'closed'
  const props = useMemo<TaskComposerProps>(() => Object.freeze({
    task: { taskId: run.id, projectId },
    draft: {
      text: draft.text,
      attachments: draft.images.map(composerAttachment),
    },
    status: {
      mode: statusMode,
      placeholder: queued ? 'Add to the prompt — sent when the run starts…' : continuable ? 'Continue — add a prompt, or send to just reopen the session…' : run.status === 'waiting' ? 'Reply — / for skills, @ for files…' : 'Message the agent — / for skills, @ for files…',
      submitLabel: continuable ? 'Continue' : 'Send',
    },
    availability: {
      enabled,
      ...(providerBlocked ? { reason: providerReason ?? 'Connect an agent provider to continue.' } : !enabled ? { reason: 'Session closed — no session to resume.' } : {}),
      ...(providerBlocked && !continueAction.providerPending ? { fix: { label: 'Configure providers', href: '/settings/agents#providers' } } : {}),
    },
    actions: {
      submit: { available: enabled, enabled: enabled && !pending && (continuable || draft.text.trim() !== '' || draft.images.length > 0), pending },
      attach: { available: enabled && hosted?.attachesFiles !== false, enabled: enabled && hosted?.attachesFiles !== false, pending: false },
      chooseRunner: { available: continuable && hosted?.choosesEngine !== false && continueAction.hasRunnerChoice, enabled: continuable && hosted?.choosesEngine !== false && continueAction.hasRunnerChoice, pending: false },
      chooseModel: { available: continuable && hosted?.choosesEngine !== false && continueAction.engine.modelChoices.length > 0, enabled: continuable && hosted?.choosesEngine !== false && !continueAction.modelsLocked, pending: false, ...(continueAction.modelsLocked ? { reason: 'Model selection is locked to native coding-agent settings.' } : {}) },
    },
    ...(continuable ? { engine: continueAction.engine } : {}),
    completions: {
      skills: { status: !skillsWanted ? 'idle' : skills.isPending ? 'loading' : skills.isError ? 'unavailable' : 'ready', items: skillItems },
      files: { status: !filesWanted ? 'idle' : 'ready', items: filesWanted ? fileItems : [] },
    },
    limits: { maxAttachments: MAX_ATTACHMENTS, maxAttachmentBytes: MAX_ATTACHMENT_BYTES, accept: 'image/*,application/pdf,text/plain,text/markdown,.pdf,.txt,.md,.markdown,.log' },
    onTextChange,
    onSubmit,
    onAttachFiles,
    onRemoveAttachment,
    onSelectRunner,
    onSelectModel,
    onRequestCompletions,
    onUseSkill,
    onNavigate,
  }), [continueAction.engine, continueAction.hasRunnerChoice, continueAction.modelsLocked, continueAction.providerPending, draft.images, draft.text, enabled, fileItems, hosted?.attachesFiles, hosted?.choosesEngine, onAttachFiles, onNavigate, onRemoveAttachment, onRequestCompletions, onSelectModel, onSelectRunner, onSubmit, onTextChange, onUseSkill, pending, projectId, providerBlocked, providerReason, queued, run.id, run.status, skillItems, skills.isError, skills.isPending, skillsWanted, statusMode, continuable, filesWanted])
  return { props }
}
