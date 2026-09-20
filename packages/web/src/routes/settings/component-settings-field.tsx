import { useEffect, useRef, useState, type FocusEvent, type ReactElement } from 'react'

import type { ComponentSettingDefinition, ComponentSettingValue } from '@open-mercato/cezar-extension-api'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import { ComponentSettingsError, type CockpitComponentRegistry } from '@/component-registry/registry'

export interface ComponentSettingsFieldProps {
  readonly componentId: string
  readonly fieldKey: string
  readonly definition: ComponentSettingDefinition
  readonly value: ComponentSettingValue
  readonly defaultValue: ComponentSettingValue
  readonly registry: Pick<CockpitComponentRegistry, 'setSettings' | 'resetSettings'>
  readonly disabled?: boolean
  readonly disabledReason?: string
  readonly onSaved?: () => void
  readonly onError?: (error: unknown) => void
}

/** One generated settings row. The renderer table is intentionally private to the cockpit. */
export function ComponentSettingsField(props: ComponentSettingsFieldProps): ReactElement {
  const { definition } = props
  const label = 'label' in definition && definition.label ? definition.label : humanize(props.fieldKey)
  const description = 'description' in definition ? definition.description : undefined
  const id = `component-setting-${props.componentId.replace(/[^a-z0-9-]/gi, '-')}-${props.fieldKey.replace(/[^a-z0-9-]/gi, '-')}`
  const [error, setError] = useState<string | undefined>()
  const [saved, setSaved] = useState(false)

  const save = async (value: ComponentSettingValue): Promise<boolean> => {
    const validation = validateValue(definition, value)
    if (validation !== undefined) { setError(validation); return false }
    setError(undefined)
    try {
      await props.registry.setSettings(props.componentId, { [props.fieldKey]: value })
      setSaved(true)
      props.onSaved?.()
      return true
    } catch (caught) {
      props.onError?.(caught)
      if (caught instanceof ComponentSettingsError && caught.code === 'settings-unavailable') setError(caught.message)
      else setError(caught instanceof Error ? caught.message : 'The setting could not be saved')
      return false
    }
  }

  const reset = async () => {
    setError(undefined)
    try {
      await props.registry.resetSettings(props.componentId, props.fieldKey)
      setSaved(true)
      props.onSaved?.()
    } catch (caught) {
      props.onError?.(caught)
      setError(caught instanceof Error ? caught.message : 'The setting could not be reset')
    }
  }

  const describedBy = [description ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  const common = { id, disabled: props.disabled, 'aria-describedby': describedBy, 'aria-invalid': error !== undefined || undefined }
  const control = definition.type === 'boolean'
    ? <Switch {...common} checked={props.value === true} onCheckedChange={(checked) => void save(checked)} aria-label={label} />
    : definition.type === 'select'
      ? <Select disabled={props.disabled} value={String(props.value)} onValueChange={(value) => void save(value)}>
          <SelectTrigger id={id} aria-describedby={describedBy} aria-invalid={error !== undefined || undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {definition.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label ?? option.value}</SelectItem>)}
          </SelectContent>
        </Select>
      : definition.type === 'string'
        ? <DebouncedInput {...props} id={id} label={label} value={String(props.value)} definition={definition} disabled={props.disabled} describedBy={describedBy} onSave={save} onError={setError} />
        : definition.type === 'number'
          ? <DebouncedInput {...props} id={id} label={label} value={String(props.value)} definition={definition} disabled={props.disabled} describedBy={describedBy} onSave={save} onError={setError} number />
          : <Input {...common} value={String(props.value)} readOnly aria-label={label} />

  return (
    <div className="flex flex-col gap-2 border-b border-border/70 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor={id}>{label}</Label>
          {description ? <p id={`${id}-hint`} className="mt-1 text-[12px] text-muted-foreground">{description}</p> : null}
          {props.disabledReason ? <p className="mt-1 text-[12px] text-muted-foreground">{props.disabledReason}</p> : null}
        </div>
        {props.value !== props.defaultValue ? <Button type="button" variant="ghost" size="sm" disabled={props.disabled} onClick={() => void reset()}>Reset {label} to default</Button> : null}
      </div>
      <div className="flex min-h-9 items-center justify-between gap-3">
        {control}
        {saved && !error ? <span className="text-[11px] text-muted-foreground">Saved</span> : null}
      </div>
      {error ? <p id={`${id}-error`} role="alert" aria-live="polite" className="text-[12px] text-destructive">{error}</p> : null}
    </div>
  )
}

function DebouncedInput(props: {
  readonly componentId: string
  readonly fieldKey: string
  readonly id: string
  readonly label: string
  readonly value: string
  readonly definition: ComponentSettingDefinition & { readonly type: 'string' | 'number' }
  readonly disabled?: boolean
  readonly describedBy?: string
  readonly number?: boolean
  readonly onSave: (value: ComponentSettingValue) => Promise<boolean>
  readonly onError: (error: string | undefined) => void
}) {
  const [draft, setDraft] = useState(props.value)
  const draftRef = useRef(props.value)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dirty = useRef(false)
  const saveRef = useRef(props.onSave)
  saveRef.current = props.onSave

  useEffect(() => {
    if (!dirty.current) { draftRef.current = props.value; setDraft(props.value) }
  }, [props.value])

  const flush = () => {
    if (!dirty.current || props.disabled) return
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = undefined
    const value = props.number ? parseNumber(draftRef.current) : draftRef.current
    if (value === undefined) { props.onError('Must be a number'); return }
    void saveRef.current(value).then((ok) => { if (ok) dirty.current = false })
  }

  useEffect(() => () => {
    if (!dirty.current || props.disabled) return
    if (timer.current !== undefined) clearTimeout(timer.current)
    const value = props.number ? parseNumber(draftRef.current) : draftRef.current
    if (value !== undefined) void saveRef.current(value)
  }, [props.disabled, props.number])

  const onChange = (value: string) => {
    draftRef.current = value
    setDraft(value)
    dirty.current = true
    props.onError(undefined)
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 400)
  }
  const onBlur = (_event: FocusEvent<HTMLInputElement>) => flush()
  const definition = props.definition
  return <Input
    id={props.id}
    type={props.number ? 'number' : 'text'}
    value={draft}
    onChange={(event) => onChange(event.target.value)}
    onBlur={onBlur}
    disabled={props.disabled}
    placeholder={definition.type === 'string' ? definition.placeholder : undefined}
    min={definition.type === 'number' ? definition.min : undefined}
    max={definition.type === 'number' ? definition.max : undefined}
    step={definition.type === 'number' ? definition.step : undefined}
    aria-label={props.label}
    aria-describedby={props.describedBy}
    aria-invalid={props.describedBy?.includes('error') || undefined}
  />
}

function parseNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function validateValue(definition: ComponentSettingDefinition, value: ComponentSettingValue): string | undefined {
  if (definition.type === 'boolean') return typeof value === 'boolean' ? undefined : 'Must be a boolean'
  if (definition.type === 'string') {
    if (typeof value !== 'string') return 'Must be text'
    return value.length > (definition.maxLength ?? 256) ? `Must be at most ${definition.maxLength ?? 256} characters` : undefined
  }
  if (definition.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Must be a number'
    if (definition.integer && !Number.isSafeInteger(value)) return 'Must be a whole number'
    if (definition.min !== undefined && value < definition.min) return `Must be at least ${definition.min}`
    if (definition.max !== undefined && value > definition.max) return `Must be at most ${definition.max}`
    return undefined
  }
  return typeof value === 'string' && definition.options.some((option) => option.value === value) ? undefined : 'Choose one of the available options'
}

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/^./, (first) => first.toUpperCase())
}
