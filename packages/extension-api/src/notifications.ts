/**
 * Transient plain-text messages in Cezar's own notification UI. The host prefixes the extension's
 * display name, shows the message in the current page only, and dismisses it automatically.
 * Messages must be non-empty and at most 500 characters or the call throws `invalid-input`.
 * The cockpit allows five messages per extension in ten seconds; additional messages are dropped
 * and reported by the host without throwing. Calls without `notifications` throw
 * `permission-denied`, and calls after deactivation throw `disposed`.
 */
export interface Notifications {
  info(message: string): void
  warning(message: string): void
  error(message: string): void
}
