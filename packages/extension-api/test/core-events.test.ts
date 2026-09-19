import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  ExtensionActivated,
  ProjectChanged,
  TaskArchive,
  TaskArchived,
  TaskCancelled,
  TaskCompleted,
  TaskFailed,
  TaskStarted,
  TaskStatusChanged,
  type Commands,
  type EventToken,
  type Events,
  type ExtensionActivation,
  type ProjectChange,
  type TaskEvent,
  type TaskRef,
  type TaskTransition,
} from '@open-mercato/cezar-extension-api'

describe('core event tokens', () => {
  it('are frozen { kind, id } tokens under the reserved cezar publisher', () => {
    const tokens = [
      TaskStatusChanged,
      TaskStarted,
      TaskCompleted,
      TaskFailed,
      TaskCancelled,
      TaskArchived,
      ProjectChanged,
      ExtensionActivated,
    ]
    expect(tokens).toEqual([
      { kind: 'event', id: 'cezar.task.status-changed' },
      { kind: 'event', id: 'cezar.task.started' },
      { kind: 'event', id: 'cezar.task.completed' },
      { kind: 'event', id: 'cezar.task.failed' },
      { kind: 'event', id: 'cezar.task.cancelled' },
      { kind: 'event', id: 'cezar.task.archived' },
      { kind: 'event', id: 'cezar.project.changed' },
      { kind: 'event', id: 'cezar.extension.activated' },
    ])
    for (const token of tokens) expect(Object.isFrozen(token)).toBe(true)
  })

  it('carry narrow payloads', () => {
    for (const token of [TaskStatusChanged, TaskStarted, TaskCompleted, TaskFailed, TaskCancelled]) {
      expectTypeOf(token).toEqualTypeOf<EventToken<TaskTransition>>()
    }
    expectTypeOf(TaskArchived).toEqualTypeOf<EventToken<TaskEvent>>()
    expectTypeOf(ProjectChanged).toEqualTypeOf<EventToken<ProjectChange>>()
    expectTypeOf(ExtensionActivated).toEqualTypeOf<EventToken<ExtensionActivation>>()
    const activation: ExtensionActivation = { extensionId: 'acme.alpha', version: '1.0.0' }
    const change: ProjectChange = { projectId: null, previousProjectId: 'web' }
    // @ts-expect-error — an activation names its extension
    const missing: ExtensionActivation = { version: '1.0.0' }
    // @ts-expect-error — a task event always names its project
    const unscoped: TaskEvent = { taskId: 'r1', status: 'done' }
    expect([activation, change, missing, unscoped]).toHaveLength(4)
  })

  it('let a task event feed the task commands directly', () => {
    expectTypeOf<TaskTransition>().toExtend<TaskRef>()
    expectTypeOf<TaskEvent>().toExtend<TaskRef>()
    const unused = (events: Events, commands: Commands): void => {
      events.on(TaskCompleted, (task) => void commands.execute(TaskArchive, task))
    }
    expectTypeOf(unused).toBeFunction()
  })
})
