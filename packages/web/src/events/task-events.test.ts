import { describe, expect, it, vi } from 'vitest'

import type { TaskTransitionEvent } from '@open-mercato/cezar-api-client'

import { createEventBus } from './bus'
import { emitTaskEvents, taskEventsFor } from './task-events'

type Status = TaskTransitionEvent['status']

/** A wire frame for task `t1` of project `web`. */
function wire(previousStatus: Status, status: Status, archive: [boolean, boolean] = [false, false]): TaskTransitionEvent {
  return { project: 'web', id: 't1', status, previousStatus, previousArchived: archive[0], archived: archive[1] }
}

const ids = (transition: TaskTransitionEvent) => taskEventsFor(transition).map((event) => event.token.id)

describe('taskEventsFor', () => {
  it.each<[string, TaskTransitionEvent, string[]]>([
    ['queued → running: a start', wire('queued', 'running'), ['cezar.task.status-changed', 'cezar.task.started']],
    ['waiting → running: an answered question, not a start', wire('waiting', 'running'), ['cezar.task.status-changed']],
    ['done → running: a Continue is a start', wire('done', 'running'), ['cezar.task.status-changed', 'cezar.task.started']],
    ['failed → running: a direct Continue of a failed task is a start', wire('failed', 'running'), ['cezar.task.status-changed', 'cezar.task.started']],
    ['failed → queued: a deferred resume (an auto-resume) re-queues, only a status change', wire('failed', 'queued'), ['cezar.task.status-changed']],
    ['running → review: a successful finish', wire('running', 'review'), ['cezar.task.status-changed', 'cezar.task.completed']],
    ['running → done: a successful finish', wire('running', 'done'), ['cezar.task.status-changed', 'cezar.task.completed']],
    ['review → done: an accepted review, not a second completion', wire('review', 'done'), ['cezar.task.status-changed']],
    ['running → failed', wire('running', 'failed'), ['cezar.task.status-changed', 'cezar.task.failed']],
    ['queued → cancelled: no start before it', wire('queued', 'cancelled'), ['cezar.task.status-changed', 'cezar.task.cancelled']],
    ['running → waiting: a question, only a status change', wire('running', 'waiting'), ['cezar.task.status-changed']],
    ['archive only', wire('done', 'done', [false, true]), ['cezar.task.archived']],
    ['restore only: nothing', wire('done', 'done', [true, false]), []],
    ['already archived, status change only', wire('done', 'running', [true, true]), ['cezar.task.status-changed', 'cezar.task.started']],
    [
      'status and archive together: the status events, then archived',
      wire('running', 'done', [false, true]),
      ['cezar.task.status-changed', 'cezar.task.completed', 'cezar.task.archived'],
    ],
  ])('%s', (_name, transition, expected) => {
    expect(ids(transition)).toEqual(expected)
  })

  it('carries ids and statuses only: a TaskTransition for status events, a TaskEvent for archived', () => {
    const events = taskEventsFor(wire('running', 'done', [false, true]))

    expect(events.map((event) => event.payload)).toEqual([
      { taskId: 't1', projectId: 'web', status: 'done', previousStatus: 'running' },
      { taskId: 't1', projectId: 'web', status: 'done', previousStatus: 'running' },
      { taskId: 't1', projectId: 'web', status: 'done' },
    ])
  })
})

describe('emitTaskEvents', () => {
  it('emits the mapped events on the bus, in order', async () => {
    const bus = createEventBus()
    const log: string[] = []
    for (const id of ['cezar.task.status-changed', 'cezar.task.completed', 'cezar.task.archived']) {
      bus.on({ kind: 'event', id }, (payload: unknown) => log.push(`${id} ${JSON.stringify(payload)}`))
    }

    emitTaskEvents(bus, wire('running', 'review', [false, true]))
    await vi.waitFor(() => expect(log).toHaveLength(3))

    expect(log).toEqual([
      'cezar.task.status-changed {"taskId":"t1","projectId":"web","status":"review","previousStatus":"running"}',
      'cezar.task.completed {"taskId":"t1","projectId":"web","status":"review","previousStatus":"running"}',
      'cezar.task.archived {"taskId":"t1","projectId":"web","status":"review"}',
    ])
  })
})
