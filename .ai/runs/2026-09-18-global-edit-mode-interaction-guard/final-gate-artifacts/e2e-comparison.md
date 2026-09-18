# e2e failure comparison — PR head vs origin/main (99a6cfb), same WSL host

## Full suite, PR (merge 7467f9f, before the review fix): 187 passed / 32 failed / 6 skipped
## Full suite, main: 184 passed / 35 failed / 6 skipped

### Failing on both (31)
- agents-dock.e2e.ts > the Agents dock against a replayed fan-out > a row opens the drill-down sheet with that agent’s output and nobody else’s
- agents-dock.e2e.ts > the Agents dock against a replayed fan-out > collapses to a one-line odometer
- agents-dock.e2e.ts > the Agents dock against a replayed fan-out > docks both sub-agents with odometer, type badge, activity and tool count
- agents-dock.e2e.ts > the Agents dock against a replayed fan-out > the long agent panel scrolls, detaches from follow-tail, and exposes the jump pill
- automations.e2e.ts > Automations > creates a GitHub poll paused, previews it, enables it from a baseline, and logs both
- commit-list.e2e.ts > the task Commits tab on a 200-commit branch > serves every commit from the API — the list really is unbounded
- composer.e2e.ts > the thread composer against a live waiting session > send delivers the reply — the transcript grows with the new user bubble over SSE
- composer.e2e.ts > the thread composer against a live waiting session > the mock answers the reply and the run parks at waiting again
- progressive-history.e2e.ts > progressive long-session history > switches between cached and live-tail threads without a near-zero destination frame
- project-groups.e2e.ts > the grouped multi-project sidebar > persists a collapse in THIS browser, so a reload keeps it and the workspace file does not
- project-groups.e2e.ts > the grouped multi-project sidebar > reorders correctly with a group expanded — no uniform-height assumption
- project-groups.e2e.ts > the grouped multi-project sidebar > scopes every group nav to its own project, and lights only the active one
- quick-list.e2e.ts > task quick-list > expands the variant group into per-variant rows, and collapses it again
- quick-list.e2e.ts > task quick-list > groups the runs under Needs you / Recent, in that order
- quick-list.e2e.ts > tasks table overview > is the home: the table renders every active fixture run with its status
- review-gate.e2e.ts > the review gate against a live parked run > Send back delivers the notes into the SAME session — the transcript grows
- settings-agents.e2e.ts > settings → agents against the live dry-run server > renders every knob, agent-agnostically named
- settings-appearance.e2e.ts > settings → appearance against the live dry-run server > the shell renders the registry sections — hidden ones absent, active one marked
- skill-search-ranking.e2e.ts > #484 skill search ranks the (almost-)exact match first > multi-keyword search still matches across name + description (#411 preserved)
- skills-update.e2e.ts > automatic Open Mercato skills updates > shows the inherited global preference and persists an explicit override
- task-thread.e2e.ts > task thread > renames the task inline and the PATCH persists server-side
- task-thread.e2e.ts > task thread > renders the task and the follow-up as right-aligned user bubbles
- task-thread.e2e.ts > task thread > tabs point at the routed Session/Changes/Files surfaces; the done run offers the closed-run actions
- task-thread.e2e.ts > task thread > the header meta line reads workflow · branch chip · ± · tokens · cost off the record
- task-thread.e2e.ts > task thread > the step rail maps the record steps to checklist rows over the progress bar
- thread-drafts.e2e.ts > a half-written reply survives leaving the task > sending it clears the draft — the next visit starts empty
- thread-drafts.e2e.ts > a half-written reply survives leaving the task > type into task A, open task B, come back — the text is still there
- thread-scroll.e2e.ts > thread virtualization on a 1,000-row transcript > auto mode virtualizes past the threshold and keeps the DOM bounded
- thread-scroll.e2e.ts > thread virtualization on a 1,000-row transcript > force-flat renders every row (the before measurement)
- thread-scroll.e2e.ts > thread virtualization on a 1,000-row transcript > restores the scroll position across a client-side leave and return
- variants-compare.e2e.ts > the variants compare view against two settled dry runs > ✔ Pick A confirms, archives B with its worktree removed, and lands on A at the gate

### Failing on main only (4)
- empty-states.e2e.ts > the 404 route > walks back to the tasks overview through the action
- queued-stack.e2e.ts > a queued run’s prompt is amendable (#472) > keeps the amendment when the run finally starts, and goes read-only
- queued-stack.e2e.ts > a queued run’s prompt is amendable (#472) > removes the stacked message
- settings-monitoring.e2e.ts > global Resources monitoring controls > persists capacity and interval mode through a cold reload

### Failing on PR only (1) — also fails on main in the focused re-run below
- github.e2e.ts > the GitHub tab against the live dry-run server > opens an issue’s detail: meta, labels, markdown body, hand-to-agent dropdowns

## Focused re-run with the review fix (github, composer, command-palette, new-task, smoke)
- PR f628550: 40 passed / 7 failed / 1 skipped
  - composer.e2e.ts > the thread composer against a live waiting session > send delivers the reply — the transcript grows with the new user bubble over SSE
  - composer.e2e.ts > the thread composer against a live waiting session > the mock answers the reply and the run parks at waiting again
  - github.e2e.ts > the GitHub tab against the live dry-run server > /github lists the real issues and PRs with honest counts
  - github.e2e.ts > the GitHub tab against the live dry-run server > opens an issue’s detail: meta, labels, markdown body, hand-to-agent dropdowns
  - smoke.e2e.ts > cockpit app shell > renders the sidebar brand and the whole nav
  - smoke.e2e.ts > cockpit app shell > marks exactly one nav item active, following the route
  - smoke.e2e.ts > mobile shell > nav drawer > opens over a backdrop, and covers the viewport top to bottom
- main: 41 passed / 6 failed / 1 skipped
  - composer.e2e.ts > the thread composer against a live waiting session > send delivers the reply — the transcript grows with the new user bubble over SSE
  - composer.e2e.ts > the thread composer against a live waiting session > the mock answers the reply and the run parks at waiting again
  - github.e2e.ts > the GitHub tab against the live dry-run server > opens an issue’s detail: meta, labels, markdown body, hand-to-agent dropdowns
  - smoke.e2e.ts > cockpit app shell > renders the sidebar brand and the whole nav
  - smoke.e2e.ts > cockpit app shell > marks exactly one nav item active, following the route
  - smoke.e2e.ts > mobile shell > nav drawer > opens over a backdrop, and covers the viewport top to bottom
