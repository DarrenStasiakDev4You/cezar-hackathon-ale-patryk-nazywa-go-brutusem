import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  TaskArchive,
  TaskContinue,
  TaskStop,
  type CommandToken,
  type TaskArchiveInput,
  type TaskArchiveResult,
  type TaskAttachment,
  type TaskContinueInput,
  type TaskContinueResult,
  type TaskRef,
  type TaskStopResult,
} from '@open-mercato/cezar-extension-api'

describe('core task command tokens', () => {
  it('are frozen { kind, id } tokens under the reserved cezar publisher', () => {
    expect([TaskContinue, TaskStop, TaskArchive]).toEqual([
      { kind: 'command', id: 'cezar.task.continue' },
      { kind: 'command', id: 'cezar.task.stop' },
      { kind: 'command', id: 'cezar.task.archive' },
    ])
    for (const token of [TaskContinue, TaskStop, TaskArchive]) expect(Object.isFrozen(token)).toBe(true)
  })

  it('carry one input object and a narrow result', () => {
    expectTypeOf(TaskContinue).toEqualTypeOf<CommandToken<[input: TaskContinueInput], TaskContinueResult>>()
    expectTypeOf(TaskStop).toEqualTypeOf<CommandToken<[input: TaskRef], TaskStopResult>>()
    expectTypeOf(TaskArchive).toEqualTypeOf<CommandToken<[input: TaskArchiveInput], TaskArchiveResult>>()
    const input: TaskArchiveInput = { taskId: 'r1', projectId: 'web', archived: false }
    // @ts-expect-error — a task is addressed by its id
    const missing: TaskRef = { projectId: 'web' }
    expect([input, missing]).toHaveLength(2)
  })

  it('let a continue carry the engine, the account and a prompt with attachments', () => {
    const attachment: TaskAttachment = { mediaType: 'image/png', data: 'iVBORw0KGgo=', name: 'shot.png' }
    const full: TaskContinueInput = {
      taskId: 'r1',
      projectId: 'web',
      runner: 'codex',
      model: '',
      agentProfile: 'work',
      text: 'Fix the failing test.',
      attachments: [attachment],
    }
    // @ts-expect-error — attachments are a list of files, not a string
    const notAList: TaskContinueInput = { taskId: 'r1', attachments: 'x' }
    // @ts-expect-error — a model is named by its id
    const numericModel: TaskContinueInput = { taskId: 'r1', model: 1 }
    expect([full, notAList, numericModel]).toHaveLength(3)
  })
})
