import { PanelsTopLeftIcon } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'

export type EditModeControlProps = {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
}

/** Global shell chrome for entering and leaving layout edit mode. */
export function EditModeControl({ enabled, onEnabledChange }: EditModeControlProps) {
  if (enabled) {
    return (
      <div
        data-slot="edit-mode-banner"
        role="status"
        className="fixed inset-x-0 top-0 z-[100] flex min-h-12 items-center justify-center gap-3 bg-pending px-4 py-2 text-sm font-bold text-foreground shadow-md [padding-left:max(1rem,env(safe-area-inset-left))] [padding-right:max(1rem,env(safe-area-inset-right))]"
      >
        <span>You are in edit mode</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-slot="edit-mode-exit"
          className="border-border bg-card font-bold text-foreground hover:bg-muted"
          onClick={() => onEnabledChange(false)}
        >
          Exit edit mode
        </Button>
      </div>
    )
  }

  return (
    <div
      data-slot="edit-mode-control"
      className="fixed top-3 right-4 z-[60] [padding-right:env(safe-area-inset-right)]"
    >
      <Button
        type="button"
        variant="outline"
        size="default"
        aria-label="Edit mode"
        aria-pressed={false}
        title="Edit mode"
        onClick={() => onEnabledChange(true)}
        className="min-h-11 gap-2 px-3 font-semibold shadow-lg backdrop-blur-sm"
      >
        <PanelsTopLeftIcon className="size-5" aria-hidden="true" />
        <span>Edit mode</span>
      </Button>
    </div>
  )
}
