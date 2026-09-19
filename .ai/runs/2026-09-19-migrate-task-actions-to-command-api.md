# Execution plan — migrate the task actions to the Command API

**Branch:** `feat/migrate-task-actions-to-command-api` · **Base:** `main`

Source doc: `.ai/specs/2026-09-19-migrate-task-actions-to-command-api.md` (spec PR #14, merged)

## 🎯 Goal

Every Task UI path that continues or archives a task goes through the command registry that #11 added, so the API client is reached only from the core handlers, and extensions get the same continue that the composer uses (runner, model, account, prompt, attachments).

## Scope

- `packages/extension-api/src/core-commands.ts`: `TaskAttachment` plus four optional `TaskContinueInput` fields (types only).
- `packages/web/src/commands/`: the continue validator and handler learn the new fields; `invalidateTaskKeys` gains an optional options argument; new `errors.ts` (`apiErrorOf`), `useTaskRefetch` in `provider.tsx`, and `boundary.ts` (the source scan).
- Call sites: `routes/task-thread/follow-up-engine.tsx`, `deliver-prompt.ts`, `review-panel.tsx`, `ask-answer.ts`, `routes/global-tasks.tsx`; `useContinueRun` is deleted from `api/queries.ts`.
- Test harnesses that render a `useAskAnswer` consumer gain `CommandsProvider`.
- Docs: `packages/extension-api/README.md`, `AGENTS.md`.

## Non-goals

- The deferred actions listed in the spec (Q9): delete, rename, pin, read receipts, bulk archive, PR creation, finish, live messages.
- Any server, route, contract or state-file change.
- A shared test render helper.
- Dedicated `setRunner` / `setModel` commands (Q3).

## Risks

- Two recovery paths (the composer's 409 re-route, the Ask delivery's idle-teardown retry) read the HTTP status; `apiErrorOf` must keep them working. Each keeps a test with a real stubbed 409.
- Settle timing (Q10): the composer and the Ask delivery must keep waiting for the refetch through `useTaskRefetch`; the global Tasks archive toggles unlock one request later (accepted in the spec).
- Harness ripple: eight test harnesses gain `CommandsProvider`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The continue input and the helpers

- [x] 1.1 Extension API fields: TaskAttachment and the optional TaskContinueInput fields — 54648d5c
- [x] 1.2 Core validator and handler forward the new continue fields — 9443b637
- [x] 1.3 apiErrorOf and useTaskRefetch — 61597cf5

### Phase 2: The task thread and the Ask delivery

- [x] 2.1 The composer and its pickers run TaskContinue — f2e67972, 85b74cba
- [x] 2.2 The review panel's send-back runs TaskContinue — 309b4f61
- [x] 2.3 The Ask delivery runs TaskContinue and useContinueRun is deleted — c9269491

### Phase 3: Global Tasks, the boundary scan and docs

- [x] 3.1 The global Tasks archive runs TaskArchive — c893a8f9
- [x] Gate fix: the cross-project navigation harness renders global Tasks and needs CommandsProvider — eec7ea04
- [x] 3.2 The boundary scan and the extension continue check — 7428e5dd
- [x] 3.3 Docs: extension API README and AGENTS.md — 068072ee
