import { PickerPill } from '@/components/picker-pill'
import type { TaskComposerProps } from '@open-mercato/cezar-extension-api'

/** Focus the first enabled engine control inside a mounted composer slot. */
export function focusEnginePicker(root: HTMLElement | null): void {
  const target = root?.querySelector<HTMLElement>('[data-slot="follow-up-engine"] button:not([disabled]), [data-slot="follow-up-engine"] [tabindex]:not([tabindex="-1"])')
  target?.scrollIntoView?.({ block: 'nearest' })
  target?.focus()
}

export function ContinuationEnginePicker({
  engine,
  actions,
  onSelectRunner,
  onSelectModel,
}: Pick<TaskComposerProps, 'engine' | 'actions' | 'onSelectRunner' | 'onSelectModel'>) {
  if (!engine) return null
  const runnerOptions = engine.runnerChoices.map((choice) => ({
    value: choice.account ? `${choice.runner}:${choice.account}` : choice.runner,
    label: choice.label,
    desc: choice.description,
  }))
  const selectedRunner = engine.account ? `${engine.runner}:${engine.account}` : engine.runner
  return (
    <div data-slot="follow-up-engine" className="flex flex-wrap items-center gap-1.5">
      {actions.chooseRunner.available ? (
        <PickerPill
          slot="follow-up-runner-pill"
          ariaLabel="Runner"
          label={engine.runnerChoices.find((choice) => (choice.account ? `${choice.runner}:${choice.account}` : choice.runner) === selectedRunner)?.label ?? engine.runner}
          value={selectedRunner}
          disabled={!actions.chooseRunner.enabled}
          disabledHint={actions.chooseRunner.reason}
          onPick={(value) => {
            const choice = engine.runnerChoices.find((row) => (row.account ? `${row.runner}:${row.account}` : row.runner) === value)
            if (choice) onSelectRunner(choice.runner, choice.account)
          }}
          options={runnerOptions}
        />
      ) : null}
      <PickerPill
        slot="follow-up-model-pill"
        ariaLabel="Model"
        label={engine.modelLabel}
        value={engine.model}
        readOnly={!actions.chooseModel.available || !actions.chooseModel.enabled}
        disabledHint={actions.chooseModel.reason}
        onPick={onSelectModel}
        options={engine.modelChoices.map((choice) => ({ value: choice.id, label: choice.label, desc: choice.description }))}
        status={engine.modelNote}
      />
    </div>
  )
}

export type ContinuationEnginePickerProps = Pick<TaskComposerProps, 'engine' | 'actions' | 'onSelectRunner' | 'onSelectModel'>
