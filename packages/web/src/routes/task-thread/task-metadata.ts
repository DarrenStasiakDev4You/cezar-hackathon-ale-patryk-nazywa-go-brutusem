import { useMemo, useRef, useState } from 'react'

import {
  useAgentProfiles,
  useConfig,
  useHealth,
  useProjectRepoBase,
  useReferenceProjectId,
  type ReferenceStatusEntry,
  type ReferenceStatusLookup,
} from '@/api/queries'
import { DEFAULT_AGENT_ACCOUNT_ID, type ApiRun } from '@open-mercato/cezar-api-client'
import {
  type TaskActionState,
  type TaskMetadataActions,
  type TaskMetadataEngine,
  type TaskMetadataIntents,
  type TaskMetadataModel,
  type TaskMetadataProps,
  type TaskMetadataReference,
  type TaskMetadataTaskRef,
} from '@open-mercato/cezar-extension-api'
import { useReferenceLookup } from '@/components/reference-status'
import { toast } from '@/components/ui/toaster'
import { scopeTo, useActiveProjectId, useNavigate } from '@/lib/project-router'
import { runTitle } from '@/lib/task-groups'
import { prNumber, taskIssueUrl, taskPrUrl, taskReferences, workflowLabel, type TaskReference } from '@/lib/tasks-table'
import { usageMetricVisibility } from '@/lib/token-metrics'
import { isHttpUrl } from '@/lib/utils'

import { useAskAnswer, type AskAnswerDelivery } from './ask-answer'
import { resolveConflictsPrompt, runActionFlags } from './run-actions'
import { useFrozenJson } from '@/lib/use-frozen-json'

/** Values `navigate` already warned about, once per value per page load. */
const warnedNavigations = new Set<string>()

/**
 * The only reader of a run behind the task metadata contract. Its data is frozen while its JSON is
 * unchanged, and its intents keep one identity while reading the latest task through a ref.
 */
export function useTaskMetadataController(
  run: ApiRun,
  options: { readonly chooseEngine?: () => void } = {},
): TaskMetadataProps {
  const health = useHealth()
  const config = useConfig()
  const profiles = useAgentProfiles()
  const repoBase = useProjectRepoBase()
  const referenceProjectId = useReferenceProjectId()
  const activeProjectId = useActiveProjectId()
  const navigate = useNavigate()
  const flags = runActionFlags(run)
  const references = useMemo(() => taskReferences(run, repoBase), [run, repoBase])
  const requests = useMemo(
    () =>
      referenceProjectId === undefined
        ? []
        : references.map((reference) => ({ projectId: referenceProjectId, kind: reference.kind, number: reference.number })),
    [references, referenceProjectId],
  )
  const lookup = useReferenceLookup(requests)
  const headerReferences = referencesOf(run, references, repoBase, referenceProjectId, lookup)
  const conflicting = headerReferences.some((reference) => conflictingPr(reference) !== undefined)
  const metricVisibility = usageMetricVisibility(health.data)
  const usage = {
    ...(metricVisibility.tokens && run.inputTokens !== undefined ? { inputTokens: run.inputTokens } : {}),
    ...(metricVisibility.tokens && run.outputTokens !== undefined ? { outputTokens: run.outputTokens } : {}),
    ...(metricVisibility.cost && run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
  }
  const automationHref =
    run.automation && health.data?.capabilities?.automations === true
      ? String(scopeTo(activeProjectId, `/automations/${encodeURIComponent(run.automation.automationId)}/log`))
      : undefined
  const delivery = useAskAnswer(run)
  const [resolving, setResolving] = useState(false)
  const data = useFrozenJson({
    task: {
      id: run.id,
      projectId: activeProjectId ?? '',
      title: runTitle(run),
    } satisfies TaskMetadataTaskRef,
    metadata: {
      workflow: workflowLabel(run),
      ...(run.branch ? { branch: run.branch } : {}),
      ...(run.diffStat
        ? {
            diff: {
              added: run.diffStat.adds,
              removed: run.diffStat.dels,
              files: run.diffStat.files,
              ...(run.diffStat.repointed ? { repointed: true } : {}),
            },
          }
        : {}),
      ...(headerReferences.length > 0 ? { references: headerReferences } : {}),
      ...(run.automation
        ? {
            automation: {
              automationId: run.automation.automationId,
              ...(automationHref !== undefined ? { href: automationHref } : {}),
            },
          }
        : {}),
      ...(Object.keys(usage).length > 0 ? { usage } : {}),
      engine: engineOf(run, config.data?.defaultRunner, profiles.data?.profiles),
    } satisfies TaskMetadataModel,
    actions: {
      resolveConflicts: actionState(conflicting, resolving || delivery.isPending, {
        blocked: Boolean(delivery.blockedBy),
        reason: delivery.reason,
      }),
      chooseEngine: actionState(options.chooseEngine !== undefined && flags.continueRun, false),
    } satisfies TaskMetadataActions,
  })

  const latest = useRef({ run, data, delivery, options, automationHref })
  latest.current = { run, data, delivery, options, automationHref }
  const [intents] = useState<TaskMetadataIntents>(() => ({
    resolveConflicts: (prNumberToResolve: number) => {
      const { data: now, delivery: seam } = latest.current
      if (!allowed(now.actions.resolveConflicts)) return
      const isConflicting = (now.metadata.references ?? []).some(
        (reference) => conflictingPr(reference) === prNumberToResolve,
      )
      if (!isConflicting) return
      setResolving(true)
      void resolveConflicts(seam, prNumberToResolve).finally(() => setResolving(false))
    },
    navigate: (href: string) => {
      const allowedHref = latest.current.automationHref
      if (allowedHref !== undefined && href === allowedHref) {
        void navigate(href)
        return
      }
      if (warnedNavigations.has(href)) return
      warnedNavigations.add(href)
      console.warn(`[cezar:extensions] the task metadata ignored navigate(${JSON.stringify(href)}): not a link its props carry`)
    },
    chooseEngine: () => {
      const { data: now, options: current } = latest.current
      if (!allowed(now.actions.chooseEngine)) return
      current.chooseEngine?.()
    },
  }))

  return useMemo(
    () => Object.freeze({ task: data.task, metadata: data.metadata, actions: data.actions, intents }),
    [data, intents],
  )
}

function allowed(state: TaskActionState): boolean {
  return state.available && state.enabled && !state.pending
}

function actionState(
  available: boolean,
  pending: boolean,
  block: { readonly blocked: boolean; readonly reason?: string } = { blocked: false },
): TaskActionState {
  return {
    available,
    enabled: available && !pending && !block.blocked,
    pending,
    ...(block.blocked && block.reason ? { reason: block.reason } : {}),
  }
}

function conflictingPr(reference: TaskMetadataReference): number | undefined {
  return reference.kind === 'pr' && reference.number !== undefined && reference.conflicting === true
    ? reference.number
    : undefined
}

function referencesOf(
  run: ApiRun,
  references: readonly TaskReference[],
  repoBase: string | undefined,
  projectId: string | undefined,
  lookup: ReferenceStatusLookup,
): TaskMetadataReference[] {
  const known = (kind: 'PR' | 'Issue', number: number | undefined): Partial<TaskMetadataReference> =>
    projectId === undefined || number === undefined ? {} : lookupOf(lookup({ projectId, kind, number }))
  const result: TaskMetadataReference[] = []
  const prReferences = references.filter((reference) => reference.kind === 'PR')
  for (const reference of prReferences) {
    result.push({
      kind: 'pr',
      number: reference.number,
      ...(reference.url && isHttpUrl(reference.url) ? { url: reference.url } : {}),
      ...known('PR', reference.number),
    })
  }
  const prUrl = taskPrUrl(run)
  if (prUrl && isHttpUrl(prUrl) && !prReferences.some((reference) => reference.url === prUrl)) {
    result.push({ kind: 'pr', url: prUrl })
  }
  const issueUrl = taskIssueUrl(run, repoBase)
  if (issueUrl && isHttpUrl(issueUrl)) {
    const number = prNumber(issueUrl)
    result.push({
      kind: 'issue',
      ...(number ? { number: Number(number) } : {}),
      url: issueUrl,
      ...known('Issue', number ? Number(number) : undefined),
    })
  }
  return result
}

function lookupOf(entry: ReferenceStatusEntry): Partial<TaskMetadataReference> {
  return {
    ...(entry.status !== undefined ? { status: entry.status } : {}),
    ...(entry.state !== 'idle' ? { lookup: entry.state } : {}),
    ...(entry.state === 'unavailable' && entry.reason ? { lookupReason: entry.reason } : {}),
    ...(entry.conflicting !== undefined ? { conflicting: entry.conflicting } : {}),
  }
}

function engineOf(
  run: ApiRun,
  defaultRunner: string | undefined,
  profiles: readonly { id: string; label: string }[] | undefined,
): TaskMetadataEngine {
  const runner = run.runner ?? defaultRunner ?? 'claude'
  const model = run.model ?? 'auto'
  const accountId = [...run.steps].reverse().find((step) => step.profileId)?.profileId
  const account =
    accountId === undefined
      ? undefined
      : accountId === DEFAULT_AGENT_ACCOUNT_ID
        ? 'default'
        : (profiles?.find((profile) => profile.id === accountId)?.label ?? `${accountId} (removed)`)
  const identity = run.modelIdentity && run.modelIdentity !== model ? run.modelIdentity : undefined
  return { runner, model, ...(account !== undefined ? { account } : {}), ...(identity !== undefined ? { identity } : {}) }
}

async function resolveConflicts(delivery: AskAnswerDelivery, prNumberToResolve: number): Promise<void> {
  const reopened = delivery.mode === 'resume'
  const failure = await delivery.send(resolveConflictsPrompt(prNumberToResolve))
  if (failure) toast(failure, { tone: 'danger' })
  else toast(`${reopened ? 'Task reopened' : 'Sent to the task'} — resolving conflicts in PR #${prNumberToResolve}`)
}
