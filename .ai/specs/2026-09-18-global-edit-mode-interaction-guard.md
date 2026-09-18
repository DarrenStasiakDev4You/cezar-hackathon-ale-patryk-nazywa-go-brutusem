# Centralny strażnik interakcji w trybie edycji

## 📋 TLDR

Rozszerzamy istniejący globalny `editMode` w shellu o centralny mechanizm, który przechwytuje aktywacje elementów interaktywnych i nie dopuszcza do nawigacji ani akcji biznesowych. Wyjątkiem są akcje należące do edytora layoutu oraz opcjonalne otwarcie dropdownu potrzebne do identyfikacji elementu.

## Resolved assumptions (autonomous defaults)

- **Q1 — Zakres istniejącej kontrolki vs. osobna zmiana:** To osobna specyfikacja rozszerzająca istniejącą kontrolkę i branch `feat/global-edit-mode-control`; wcześniejsza specyfikacja pozostaje źródłem prawdy dla wejścia/wyjścia i warstwy wizualnej.
- **Q2 — Dozwolone wyjątki:** Domyślnie dozwolone są tylko akcje oznaczone jako należące do edytora; dropdown może otworzyć się wyłącznie przez jawny marker, ale jego elementy biznesowe pozostają zablokowane.
- **Q3 — Zakres zdarzeń:** Strażnik blokuje aktywacje użytkownika (`click`, aktywację formularza i równoważne wejście klawiaturą), ale nie blokuje programowych przekierowań niezwiązanych z aktywacją oraz zdarzeń hover/focus potrzebnych do inspekcji.

## 📋 Problem Statement

Branch `feat/global-edit-mode-control` already owns `editMode` in `AppShell`, dims the shell surface, keeps the edit banner/control alive, and blocks anchor clicks at the shell boundary. That is only a partial safety boundary: buttons, menu items, command-palette triggers, form submissions, and custom interactive elements can still run their business callbacks while the user is selecting or editing layout. Adding `if (editMode)` to every widget would duplicate policy, miss future widgets, and make third-party or extension content unsafe by default.

The invariant is simple: normal mode preserves the application's current behavior; edit mode converts user activation into an editor interaction (or a no-op), never into navigation or business mutation. Visual hover/focus affordances remain available because they help identify the element being edited.

## 📋 Proposed Solution

Add one shell-owned interaction guard at the same global boundary that already owns `editMode`. The guard runs during capture for user activation events and applies a small, explicit policy:

| Context | Edit-mode result |
|---|---|
| Normal mode | Existing link, button, form, dropdown and widget behavior is unchanged. |
| Editor-owned control | The edit-mode action is allowed to run. |
| Explicit dropdown trigger marked as inspectable | The menu may open so the user can identify/select an item; its business actions remain guarded. |
| Any other link, button, submit control or interactive element | Default action and descendant business handler are prevented. |
| Hover, focus, pointer movement and text selection | Allowed; visual reveal and inspection still work. |
| Programmatic navigation not caused by a user activation | Outside this guard's scope and remains unchanged. |

The implementation should expose a narrow DOM policy rather than a React context that every widget must consume. Existing and future widgets are protected by default. The editor can opt an element into an allowed action with a stable data attribute, and a dropdown trigger can opt into opening-only behavior with a separate attribute. These attributes are infrastructure contracts, not per-widget `editMode` branches.

The guard must cover both pointer and keyboard activation. It should also guard form submission at the shell boundary, because pressing Enter in a focused submit control can bypass a click-only policy. The event policy must not use `pointer-events: none`, a blanket disabled state, or an opaque overlay: those approaches remove hover/focus semantics and prevent the editor from locating the element.

The existing branch's link-only `onClickCapture` is the starting point to replace. The source-of-truth implementation remains `packages/web/src/components/app-shell.tsx`; a small policy/helper module is preferred if it makes the event matrix independently testable. The existing `EditModeControl` remains the only editor-owned shell chrome for this slice.

### Research notes

The boundary follows the same product distinction used by design tools: editing and previewing/prototyping are separate interaction modes, so a canvas can expose structure without executing the resulting flow. Figma documents separate Design and Prototype modes and treats interaction triggers as mode-specific behavior ([Figma prototyping guide](https://help.figma.com/hc/en-us/articles/360040314193-Guide-to-prototyping-in-Figma), [Figma prototype triggers](https://help.figma.com/hc/en-us/articles/360035725574-Prototype-triggers)). WordPress similarly treats link editing as an editor operation over content that would otherwise navigate ([WordPress link editing](https://wordpress.org/documentation/article/link-editing/)). The proposed solution adopts the useful part of both patterns—central mode ownership and explicit editor affordances—without introducing a prototype runtime or a new widget API.

## 📋 Architecture

### Ownership and event flow

1. `AppShell` owns the existing `editMode` boolean and mounts the guard once around the routed surface.
2. A capture handler receives a user activation before a descendant's business callback.
3. The guard finds the nearest interactive target and classifies it as `editor`, `inspectable-dropdown`, or `business/default`.
4. In `business/default`, it calls `preventDefault()` and stops propagation so router navigation, button callbacks, menu selection, form submission and widget actions do not run.
5. In `editor`, it leaves the event untouched. In `inspectable-dropdown`, it allows only the trigger's open behavior; menu-item activation is still classified as business/default.

The classification must be based on the composed event target and nearest ancestor, so clicks on an icon or label inside a button are governed by the button. It must tolerate portals: an open menu rendered outside the shell's visual surface is still under the shell guard if the guard is attached to the AppShell root or a document-level capture seam. If the UI library's portal escapes the React tree, the implementation must use the smallest shared event boundary that still covers it and document the boundary in tests.

Recommended markers:

- `data-edit-mode-action="allow"`: an editor-owned action that is safe to run in edit mode.
- `data-edit-mode-open="allow"`: an optional trigger that may open a menu for identification; it does not grant permission to its menu items.
- `data-edit-mode-ignore`: reserved only for non-interactive presentation content if the event classifier needs an escape hatch; it must never allow a business action.

The markers should be applied to the existing edit-mode control and exit button through their component implementation. No product widget should be required to read `editMode`. If a future widget needs a real editing action, it explicitly marks that action as editor-owned and tests the action's safety.

### Event contract

- `click`: primary pointer and keyboard activation boundary; blocked by default in edit mode.
- `submit`: blocked by default in edit mode, including implicit form submission; editor-owned forms must opt in explicitly.
- `keydown`: only prevent keys that would activate a guarded control if the browser/library does not emit a cancellable click in time; do not block arrows, Escape, Tab, text editing or screen-reader navigation.
- `pointerdown`, `pointerup`, `mouseenter`, `focus`, `focusin`: remain available unless a component-specific menu primitive requires a documented trigger exception.

The guard is synchronous and local. It adds no API, storage, event-bus topic, browser global, or persistence. It does not intercept navigation caused by an effect, server response, or external browser action; those are not interactive widget activation and must not be silently changed by edit mode.

## 📋 Data Model

No data model changes. `editMode` remains an in-memory shell boolean. The `data-edit-mode-*` attributes are DOM policy markers only; they are not persisted user data, configuration, or a public API payload.

## 📋 API Contracts

No HTTP, SSE, WebSocket, CLI or extension contract changes. The implementation adds only an internal web event-policy seam and its tests. If the marker names are later reused by extension components, that follow-up must define and version an extension contract separately; this spec does not publish them.

## 📋 UI/UX

The visual behavior from the existing global edit-mode spec remains unchanged: users can enter and exit through the shell-owned control, the banner remains visible, the routed surface may dim and reveal on hover/focus, and the control itself stays crisp and operable.

The interaction behavior becomes explicit:

- In normal mode, clicking a navigation link changes route, clicking a widget button runs its current action, and opening/choosing a dropdown behaves as it does today.
- In edit mode, clicking the same link leaves the route unchanged; clicking a business button leaves application state unchanged; submitting a form is ignored; and choosing a business menu item closes or remains governed by the menu primitive but does not execute its action. The preferred implementation keeps the menu open when the selection itself is blocked only if that is required for inspection; otherwise closing without side effects is acceptable.
- The editor control and exit action remain operable. Their accessible name, focus ring and keyboard activation must continue to work.
- An optional inspectable dropdown can open to reveal its labels or structure, but opening it cannot navigate, mutate data, submit a form or trigger a command. The spec does not require every dropdown to be inspectable; the default is blocked.

### Accessibility

Do not announce every blocked click as an error or move focus unexpectedly. Keep keyboard focus, allow Tab navigation and preserve visible focus indicators. The active banner/status from the existing control remains the mode announcement. If a blocked action needs feedback, use the editor's future selection affordance rather than a transient toast that could itself create a business action.

## 📋 Edge Cases & Failure Scenarios

- **Nested targets:** clicking an SVG/icon/span inside a button resolves to the button, not the decorative child.
- **Router links:** both the project's `Link` wrapper and plain `react-router` links remain on the blocked-by-default path.
- **Portaled menus/dialogs:** Radix or similar content rendered in a portal cannot accidentally bypass the guard. Add a regression test for the actual primitive used by the shell.
- **Dropdown trigger vs. item:** an explicitly allowed trigger may open; an item with a destructive or navigational callback is still blocked unless it is an editor-owned action.
- **Implicit form submit:** pressing Enter in an input does not submit a business form in edit mode.
- **Keyboard activation:** Space/Enter activation of buttons and links is covered without disabling ordinary focus navigation or text entry.
- **Nested editor controls:** an editor action inside a guarded widget is allowed only when the nearest editor marker is the intended action; business ancestors must not regain control through bubbling.
- **Multiple clicks or mode transitions:** leaving edit mode during an allowed editor action must not replay a previously blocked event. No event queue or deferred replay is introduced.
- **Native/external links:** edit mode blocks them just like internal links; it must not open a new tab or window.
- **Non-user redirects:** a route change caused by an existing effect or external callback remains out of scope; the guard must not cause loops or stale mode state.
- **No JavaScript / hydration boundary:** the server-rendered/static shell must remain usable enough to boot; the guard is an enhancement applied once React owns the shell.

## 📋 Risks & Impact Review

- **High — incomplete coverage:** a click-only or anchor-only guard would leave business buttons and forms active. The event matrix and regression tests are mandatory before implementation is considered complete.
- **Medium — UI library event ordering:** Radix portals and synthetic/native event ordering can differ. Verify the actual dropdown primitive in a browser and keep the policy helper independent of library internals.
- **Medium — over-blocking editor chrome:** a broad `stopPropagation()` can break the exit action or future selection tools. All editor-owned controls need explicit allow tests.
- **Low — keyboard regressions:** preventing too much at `keydown` can make the app inaccessible. Prefer cancellable `click`/`submit` capture and only add targeted key handling where tests demonstrate a gap.

Rollback is a one-commit revert: remove the guard hookup and helper while keeping the existing control and visual edit mode intact. No data migration, release manifest, API contract or backward-compatibility surface changes.

## 📋 Phasing

### Phase 1: Central policy seam

Introduce the event classifier/guard and connect it to the existing shell-owned `editMode`. Mark only the existing edit-mode entry/exit actions as editor-owned. The app remains fully usable in normal mode and all edit-mode business activations are blocked by default.

### Phase 2: Primitive coverage

Exercise the actual router links, buttons, command palette trigger, dropdown trigger/menu and form primitives used by the shell. Add the optional inspectable-dropdown marker only where a concrete identification/editing flow needs it.

### Phase 3: Browser and accessibility verification

Verify pointer and keyboard activation in a real browser at desktop and mobile widths, including a portaled dropdown. Confirm that focus, hover reveal, Escape, Tab, text entry and the exit control remain usable.

## 📋 Implementation Plan

1. **Map the current surface.** Audit the `feat/global-edit-mode-control` diff and the shared primitives used by `AppShell`; list every existing user activation that must be protected. Testable output: a fixture matrix covering link, router link, button, menu item, form submit, custom `tabIndex` action, editor control and exit control.
2. **Implement the central classifier.** Add a small shell-owned helper/component that classifies nearest interactive targets and exposes the two explicit editor markers. Testable output: unit tests for nested targets, default blocking, editor allow, inspectable dropdown trigger, and normal-mode pass-through.
3. **Replace the link-only shell guard.** Wire click/submit capture into `AppShell` and add only the required targeted keyboard handling. Testable output: shell tests prove route, callback, menu selection and form submission do not run in edit mode, while the entry/exit controls do.
4. **Cover portal and primitive behavior.** Use the actual dropdown/menu and form components from the cockpit, including portal rendering. Testable output: regression tests prove a portaled business item cannot bypass the guard and an explicitly inspectable trigger can open without executing an item action.
5. **Verify accessibility and browser behavior.** Run keyboard and pointer scenarios in normal/edit modes, Light/Dark and responsive layouts; ensure no focus loss, layout shift, accidental navigation or business mutation. Testable output: browser evidence and a short pass/fail matrix.
6. **Run the repository gate.** Execute the configured typecheck, unit/full tests, build and package checks. Testable output: all configured commands pass, with any pre-existing unrelated failure documented rather than hidden.

## 📋 Acceptance Criteria

- [ ] In normal mode, existing link, button, form, dropdown and widget behavior is unchanged.
- [ ] In edit mode, clicking internal or external links never changes the route, opens a new tab, or reloads the document.
- [ ] In edit mode, business buttons and custom interactive elements do not run their callbacks.
- [ ] In edit mode, business forms do not submit through click, Enter, or implicit submission.
- [ ] In edit mode, dropdown business items do not execute commands, mutations or navigation.
- [ ] An explicitly marked inspectable dropdown trigger may open, but opening it grants no permission to execute its items.
- [ ] The existing edit-mode entry/exit controls remain keyboard- and pointer-operable and are the only allowed actions in this slice.
- [ ] Hover, focus, Tab, Escape, text selection and screen-reader navigation remain available; the visual reveal contract is unchanged.
- [ ] The guard is mounted once at the shell boundary; no widget adds an `if (editMode)` branch to protect its normal behavior.
- [ ] Tests cover nested targets, router/plain links, buttons, forms, dropdown portals, keyboard activation and normal-mode pass-through.
- [ ] No API, storage, persistence, permissions, synchronization or widget-editing feature is added.

## 📎 Context and evidence

- Implementation context: branch `feat/global-edit-mode-control`, especially `packages/web/src/components/app-shell.tsx`, `packages/web/src/components/edit-mode-control.tsx` and `packages/web/src/styles/index.css`.
- Existing design source: `.ai/specs/2026-09-18-global-edit-mode-control.md` from PR #1.
- Proposed mockup placeholder: `assets/global-edit-mode-interaction-guard/mockup-01-interaction-guard.html`.
