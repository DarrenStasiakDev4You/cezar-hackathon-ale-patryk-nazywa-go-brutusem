import { useEffect, useRef } from 'react'
import { matchPath, useLocation } from 'react-router'

import { ProjectChanged } from '@open-mercato/cezar-extension-api'
import type { ProjectsResponse } from '@open-mercato/cezar-api-client'

import { useProjects } from '@/api/queries'

import { useEventBus } from './provider'

/**
 * Emits `cezar.project.changed` (spec `.ai/specs/2026-09-19-extension-event-api.md`, Q6) whenever
 * the registered project the URL shows changes. Renders nothing; mounted once inside the router
 * (`app.tsx`, beside `LastLocationController`), above both the `/p/:projectId` tree and the
 * workspace pages.
 *
 * The value starts at `null`, so a page that loads on a workspace route emits nothing until the
 * user opens a project, and the last emitted value is held in a ref, so StrictMode's double
 * effect never emits twice. No replay, no getter: an extension activated later hears the next
 * change. Without an `EventBusProvider` (tests) it emits nothing at all.
 */
export function ProjectChangeReporter(): null {
  const bus = useEventBus()
  const { pathname } = useLocation()
  const projects = useProjects()
  const shown = shownProject(pathname, projects)
  const last = useRef<string | null>(null)

  useEffect(() => {
    if (bus === null || shown === undefined || shown === last.current) return
    const previousProjectId = last.current
    last.current = shown
    bus.emit(ProjectChanged, { projectId: shown, previousProjectId })
  }, [bus, shown])

  return null
}

/**
 * The registered project `pathname` shows: its id, `null` for a page that belongs to no project,
 * or `undefined` while that cannot be known yet (emit nothing).
 *
 * - no `/p/:projectId` → `null` (global Tasks, global settings);
 * - `default` → not yet: `ProjectScopeRoute` normalizes it to the boot slug with a replace
 *   navigation, and that URL is the one reported;
 * - the registry loaded and the id unknown → `null` (the "not registered here" screen);
 * - the registry still loading → not yet;
 * - the registry errored → the URL's id, the stance `ProjectScopeRoute` takes when it mounts the
 *   scope anyway.
 */
export function shownProject(
  pathname: string,
  projects: { readonly data?: ProjectsResponse | undefined; readonly isError: boolean },
): string | null | undefined {
  const raw = matchPath({ path: '/p/:projectId', end: false }, pathname)?.params.projectId
  if (raw === undefined || raw === '') return null
  // Decoded like `useParams` in `ProjectScopeRoute` (the router decodes the path before
  // matching; `matchPath` alone does not), so both name the same project.
  const projectId = safelyDecode(raw)
  if (projectId === 'default') return undefined
  if (projects.data !== undefined) {
    const known =
      projects.data.bootProject === projectId || projects.data.projects.some((project) => project.id === projectId)
    return known ? projectId : null
  }
  return projects.isError ? projectId : undefined
}

function safelyDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
