import type { Notifications } from '@open-mercato/cezar-extension-api'

import type { ExtensionScope } from './registry'

export type NotificationTone = 'default' | 'warning' | 'danger'

export interface NotificationServiceOptions {
  readonly notify: (message: string, options: { readonly tone: NotificationTone }) => void
  readonly onDropped?: (extensionId: string) => void
  readonly now?: () => number
}

interface WindowState {
  timestamps: number[]
  reported: boolean
}

const WINDOW_MS = 10_000
const MAX_NOTIFICATIONS = 5
const MAX_MESSAGE_LENGTH = 500

/** Pure notification service; the cockpit supplies the actual toast function. */
export function createNotificationService(options: NotificationServiceOptions): {
  forExtension(scope: ExtensionScope): Notifications
} {
  const windows = new Map<string, WindowState>()
  const now = options.now ?? Date.now
  const onDropped = options.onDropped ?? ((extensionId: string) => {
    console.warn(`[cezar:extensions] ${extensionId}: notification rate limit exceeded`)
  })

  const send = (scope: ExtensionScope, message: string, tone: NotificationTone): void => {
    scope.assertLive()
    if (typeof message !== 'string' || message.length === 0 || message.length > MAX_MESSAGE_LENGTH) {
      throw Object.assign(new Error('Notification message must be a non-empty string of at most 500 characters'), {
        code: 'invalid-input' as const,
      })
    }

    const time = now()
    const state = windows.get(scope.extension.id) ?? { timestamps: [], reported: false }
    state.timestamps = state.timestamps.filter((timestamp) => time - timestamp < WINDOW_MS)
    if (state.timestamps.length === 0) state.reported = false
    if (state.timestamps.length >= MAX_NOTIFICATIONS) {
      if (!state.reported) {
        state.reported = true
        try {
          onDropped(scope.extension.id)
        } catch {
          // A diagnostic callback must not turn a dropped notification into an extension failure.
        }
      }
      windows.set(scope.extension.id, state)
      return
    }

    state.timestamps.push(time)
    windows.set(scope.extension.id, state)
    options.notify(`${scope.extension.name}: ${message}`, { tone })
  }

  return {
    forExtension(scope) {
      return Object.freeze({
        info: (message: string) => send(scope, message, 'default'),
        warning: (message: string) => send(scope, message, 'warning'),
        error: (message: string) => send(scope, message, 'danger'),
      })
    },
  }
}
