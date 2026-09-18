/**
 * Something the extension or the host can release. Every `register`/`on`/`provide` call returns
 * one, and the host disposes everything an extension registered when it deactivates.
 *
 * `dispose()` is idempotent: calling it a second time does nothing.
 */
export interface Disposable {
  dispose(): void
}
