import { useState, useSyncExternalStore } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CenteredState } from '@/components/centered-state'
import { toast } from '@/components/ui/toaster'
import { useExtensions, useSetExtensionApproval } from '@/api/queries'
import { extensionRuntimeDiagnostics } from '@/extensions/loader'
import type { ExtensionInventoryEntry } from '@open-mercato/cezar-api-client'

function useRuntimeDiagnostics() {
  return useSyncExternalStore(
    extensionRuntimeDiagnostics.subscribe,
    extensionRuntimeDiagnostics.list,
    extensionRuntimeDiagnostics.list,
  )
}

function permissionLabel(permission: string): string {
  return {
    'ui.components': 'interface components',
    'commands.execute': 'commands',
    storage: 'extension storage',
    events: 'events',
    network: 'network intent',
    notifications: 'notifications',
  }[permission] ?? permission
}

function statusLabel(entry: ExtensionInventoryEntry): string {
  if (entry.status === 'ready') return 'Available'
  if (entry.status === 'permission-required') return 'Permission required'
  if (entry.status === 'duplicate') return 'Duplicate'
  return 'Rejected'
}

export function ExtensionsSection() {
  const inventory = useExtensions()
  const runtime = useRuntimeDiagnostics()
  const approval = useSetExtensionApproval()
  const [reloadNeeded, setReloadNeeded] = useState(false)

  if (inventory.isPending) {
    return <p data-slot="extensions-settings-loading" className="p-4 text-[13px] text-soft-foreground md:p-6">Checking local extensions…</p>
  }
  if (inventory.isError) {
    return (
      <div role="alert" data-slot="extensions-settings-error" className="flex flex-col gap-3 p-4 md:p-6">
        <p className="text-sm text-danger">Local extension inventory did not load: {inventory.error.message}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void inventory.refetch()}>Check again</Button>
      </div>
    )
  }
  const data = inventory.data
  if (!data.available) {
    return <CenteredState title="Local extensions are unavailable in hosted mode" subtitle="Open this cockpit on the machine that owns the extensions directory." tone="neutral" icon={<span aria-hidden="true">◆</span>} heading="h2" />
  }
  const failure = approval.error?.message ?? (runtime.length > 0 ? runtime.map((item) => item.message).join(' ') : null)
  return (
    <div data-slot="extensions-settings-section" className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pb-[calc(90px+env(safe-area-inset-bottom))] md:p-6 md:pb-6">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Extensions</h2>
        <p className="text-[13px] text-muted-foreground">Local extensions are loaded from <code>~/.cezar/extensions</code>. Cezar checks them before loading code.</p>
      </div>
      {failure && <div role="alert" data-slot="extensions-settings-alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">{failure}</div>}
      {reloadNeeded && (
        <div role="status" data-slot="extensions-reload-needed" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-[13px]">
          <span>Permissions changed. Reload the cockpit to activate this package.</span>
          <Button type="button" size="sm" onClick={() => window.location.reload()}>Reload cockpit</Button>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 text-[12px] text-soft-foreground">
        <span>{data.extensions.length === 0 ? `No packages found. Place an unpacked package in ${data.directory}.` : `${data.extensions.length} package${data.extensions.length === 1 ? '' : 's'} found.`}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void inventory.refetch()}>Check again</Button>
      </div>
      {data.diagnostics.length > 0 && <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">One or more local extension packages need attention. See the package cards below.</div>}
      <ul className="flex flex-col gap-3">
        {data.extensions.map((entry) => (
          <ExtensionCard key={`${entry.candidate}:${entry.id ?? ''}`} entry={entry} approving={approval.isPending} onApprove={() => {
            approval.mutate({ id: entry.id!, approved: true }, {
              onSuccess: () => { setReloadNeeded(true); toast('Extension permissions approved. Reload the cockpit to activate it.') },
              onError: (error) => toast(error.message, { tone: 'danger' }),
            })
          }} />
        ))}
      </ul>
    </div>
  )
}

function ExtensionCard({ entry, approving, onApprove }: { entry: ExtensionInventoryEntry; approving: boolean; onApprove: () => void }) {
  const bad = entry.status === 'rejected' || entry.status === 'duplicate'
  return (
    <li data-slot="extension-card" data-status={entry.status} className="rounded-lg border border-border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{entry.name ?? entry.candidate}</h3>
            <Badge variant={bad ? 'destructive' : 'outline'}>{statusLabel(entry)}</Badge>
          </div>
          <p className="mt-1 break-all font-mono text-[11px] text-soft-foreground">{entry.id ?? entry.candidate}{entry.version ? ` · v${entry.version}` : ''}</p>
        </div>
        {entry.status === 'permission-required' && <Button type="button" size="sm" disabled={approving} onClick={onApprove}>Approve permissions</Button>}
      </div>
      {entry.description && <p className="mt-3 text-[13px] text-muted-foreground">{entry.description}</p>}
      {entry.requestedPermissions.length > 0 && <p className="mt-3 text-[12px] text-soft-foreground">Requests: {entry.requestedPermissions.map(permissionLabel).join(', ')}</p>}
      {entry.diagnostic && <p data-slot="extension-card-diagnostic" className="mt-2 break-words text-[12px] text-danger">{entry.diagnostic.message}</p>}
      {entry.status === 'ready' && <p role="status" className="mt-2 text-[12px] text-soft-foreground">Available for this page load. Reload after package or permission changes.</p>}
    </li>
  )
}
