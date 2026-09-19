import { ComposerView, type ComposerViewSkill } from '@/components/composer/composer-view'
import { ContinuationEnginePicker } from './continuation-engine-picker'
import type { TaskComposerProps } from '@open-mercato/cezar-extension-api'

/** Core's default Task Composer implementation. It is intentionally prop-only. */
export function CoreTaskComposer(props: TaskComposerProps) {
  const skills: ComposerViewSkill[] = props.completions.skills.items.map((skill) => ({
    name: skill.name,
    ...(skill.description ? { description: skill.description } : {}),
    project: skill.project,
    uses: skill.uses,
  }))
  return (
    <ComposerView
      value={props.draft.text}
      onValueChange={props.onTextChange}
      attachments={props.draft.attachments}
      onFiles={props.onAttachFiles}
      onRemove={props.onRemoveAttachment}
      sendEnabled={props.actions.submit.available && props.actions.submit.enabled}
      onSend={props.onSubmit}
      disabled={!props.availability.enabled}
      disabledReason={props.availability.reason}
      allowEmptySubmit={props.status.mode === 'continue'}
      placeholder={props.status.placeholder}
      sendAriaLabel={props.status.submitLabel}
      accept={props.limits.accept}
      skills={skills}
      mentions={props.completions.files.items}
      onRequest={props.onRequestCompletions}
      onSkillPicked={props.onUseSkill}
      footerEnd={
        props.availability.fix ? (
          <a
            href={props.availability.fix.href}
            onClick={(event) => {
              event.preventDefault()
              props.onNavigate(props.availability.fix!.href)
            }}
            className="text-xs font-medium text-foreground underline underline-offset-4"
          >
            {props.availability.fix.label}
          </a>
        ) : (
          <ContinuationEnginePicker
            engine={props.engine}
            actions={props.actions}
            onSelectRunner={props.onSelectRunner}
            onSelectModel={props.onSelectModel}
          />
        )
      }
    />
  )
}
