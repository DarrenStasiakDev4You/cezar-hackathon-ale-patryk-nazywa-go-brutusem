import { SettingsIcon } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Global edit-mode affordance. It is deliberately mounted outside routed content so no page
 * can cover it or accidentally make it part of a page-level control. */
export function EditModeControl() {
  const [enabled, setEnabled] = React.useState(false)
  const [confirmationOpen, setConfirmationOpen] = React.useState(false)

  const enable = () => {
    setEnabled(true)
    setConfirmationOpen(true)
  }

  const disable = () => setEnabled(false)

  return (
    <>
      {enabled ? (
        <div
          data-slot="edit-mode-banner"
          role="status"
          className="fixed inset-x-0 top-0 z-[55] flex min-h-12 items-center justify-center gap-3 bg-amber-300 px-4 py-2 pr-[13rem] text-sm font-bold text-amber-950 shadow-md dark:bg-yellow-400 dark:text-yellow-950 sm:pr-[15rem]"
        >
          <span>You are in edit mode</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-amber-950/40 bg-amber-100 font-bold text-amber-950 hover:bg-white dark:border-yellow-950/40 dark:bg-yellow-100 dark:text-yellow-950 dark:hover:bg-white"
            onClick={disable}
          >
            Exit edit mode
          </Button>
        </div>
      ) : null}

      <div
        data-slot="edit-mode-control"
        className="fixed top-3 right-4 z-[60] flex items-center gap-2 rounded-lg border border-border bg-card/95 p-1 pl-2 shadow-lg backdrop-blur-sm [padding-right:calc(0.25rem+env(safe-area-inset-right))]"
      >
        <Button
          type="button"
          variant={enabled ? 'default' : 'ghost'}
          size="icon"
          aria-label={enabled ? 'Edit mode enabled' : 'Enable edit mode'}
          aria-pressed={enabled}
          title={enabled ? 'Edit mode enabled' : 'Enable edit mode'}
          onClick={enable}
          className="size-9 shrink-0"
        >
          <SettingsIcon className="size-5" aria-hidden="true" />
        </Button>
        <span className="whitespace-nowrap pr-1 text-sm font-semibold text-foreground">Edit mode</span>
      </div>

      <Dialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
        <DialogContent data-slot="edit-mode-dialog" className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit mode enabled</DialogTitle>
            <DialogDescription>
              You have enabled edit mode. You can now edit the available elements.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </>
  )
}
