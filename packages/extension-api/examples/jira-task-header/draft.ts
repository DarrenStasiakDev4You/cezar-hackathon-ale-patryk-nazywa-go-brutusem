import type { TaskHeaderMainProps, TaskHeaderReference } from '@open-mercato/cezar-extension-api'

/** Jira's summary field holds at most 255 UTF-16 code units. */
export const JIRA_SUMMARY_MAX = 255
/** Leave the draft below Jira's description limit so it can be edited safely. */
export const JIRA_DESCRIPTION_MAX = 32_000

export interface JiraIssueDraft {
  readonly summary: string
  readonly description: string
}

/** The header data used to make a draft, without action state or intents. */
export type JiraDraftInput = Pick<TaskHeaderMainProps, 'task' | 'attention' | 'engine' | 'meta'>

const KNOWN_REFERENCE_STATUSES = new Set([
  'draft',
  'review-required',
  'changes-requested',
  'checks-pending',
  'checks-failing',
  'ready',
  'merged',
  'closed',
  'open',
  'completed',
  'not-planned',
])

/** Drafts a deterministic, plain-text Jira issue from the task header's view model. */
export function draftJiraIssue(input: JiraDraftInput): JiraIssueDraft {
  const title = input.task.title.replace(/\s+/gu, ' ').trim()
  const summary = truncate(title || `Cezar task ${input.task.taskId}`, JIRA_SUMMARY_MAX)
  const fixedLines = [
    `Drafted from Cezar task ${input.task.taskId}${input.task.projectId ? ` in project ${input.task.projectId}` : ''}.`,
    '',
    `Status: ${input.attention.label}${input.attention.queuePosition === undefined ? '' : ` #${input.attention.queuePosition}`}`,
    `Agent: ${input.engine.runner} · ${input.engine.model}${input.engine.identity ? ` (${input.engine.identity})` : ''}`,
    ...(input.meta.workflow ? [`Workflow: ${input.meta.workflow}`] : []),
    ...(input.meta.branch ? [`Branch: ${input.meta.branch}`] : []),
    ...(input.meta.diff
      ? [
          `Changes: +${input.meta.diff.added} −${input.meta.diff.removed} across ${input.meta.diff.files} ${input.meta.diff.files === 1 ? 'file' : 'files'}${input.meta.diff.repointed ? ', measured against a branch the agent checked out' : ''}`,
        ]
      : []),
  ]
  const references = (input.meta.references ?? []).map(referenceLine)
  const fixed = fixedLines.join('\n')
  const referenceBlock = references.length > 0 ? `\n${references.join('\n')}` : ''
  const requestPrefix = `${fixed}${referenceBlock}\n\nOriginal request:\n`
  const prompt = input.task.prompt
  const full = `${requestPrefix}${prompt}`

  if (full.length <= JIRA_DESCRIPTION_MAX) {
    return { summary, description: full }
  }

  const promptMarker = '… (cut to fit Jira\'s description limit)'
  const promptSpace = JIRA_DESCRIPTION_MAX - requestPrefix.length
  if (promptSpace >= promptMarker.length) {
    const shortenedPrompt = `${safePrefix(prompt, promptSpace - promptMarker.length)}${promptMarker}`
    const description = `${requestPrefix}${shortenedPrompt}`
    if (description.length <= JIRA_DESCRIPTION_MAX) return { summary, description }
  }

  const omittedMarker = (count: number) => `… and ${count} more references`
  for (let keep = references.length; keep >= 0; keep -= 1) {
    const omitted = references.length - keep
    const suffix = omitted > 0 ? `\n${omittedMarker(omitted)}` : ''
    const block = keep > 0 ? `\n${references.slice(0, keep).join('\n')}` : ''
    const description = `${fixed}${block}${suffix}`
    if (description.length <= JIRA_DESCRIPTION_MAX) return { summary, description }
  }

  // The fixed facts are contract-sized in practice. Keep them intact if a future caller supplies
  // an unexpectedly large value rather than silently changing their order or meaning.
  return { summary, description: fixed.slice(0, JIRA_DESCRIPTION_MAX) }
}

function referenceLine(reference: TaskHeaderReference): string {
  const label = reference.kind === 'pr' ? 'Pull request' : 'Issue'
  const number = reference.number === undefined ? '' : ` #${reference.number}`
  const status = referenceStatus(reference)
  const target = reference.url === undefined ? '' : `: ${reference.url}`
  return `${label}${number}${status}${target}`
}

function referenceStatus(reference: TaskHeaderReference): string {
  if (reference.status === undefined || !KNOWN_REFERENCE_STATUSES.has(reference.status)) return ''
  if (reference.lookup === 'loading' || reference.lookup === 'unknown') return ''
  return reference.lookup === 'unavailable' ? ` (last known: ${reference.status})` : ` (${reference.status})`
}

/** Truncate by UTF-16 units without leaving a dangling high surrogate. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  const suffix = '…'
  let prefix = safePrefix(value, max - suffix.length)
  return `${prefix}${suffix}`
}

function safePrefix(value: string, max: number): string {
  const prefix = value.slice(0, Math.max(0, max))
  return prefix.length > 0 && prefix.charCodeAt(prefix.length - 1) >= 0xd800 && prefix.charCodeAt(prefix.length - 1) <= 0xdbff
    ? prefix.slice(0, -1)
    : prefix
}
