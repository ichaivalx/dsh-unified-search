import { useState } from 'react'
import { Button, Input, Switch, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { providerNames } from './editor.js'

const label = { tavily: 'Tavily', exa: 'Exa', firecrawl: 'Firecrawl' }
function Select({ id, label: title, value, options, disabled, onChange }) {
  const [open, setOpen] = useState(false)
  return <div className="us-field us-field-select"><label id={`${id}-label`}>{title}</label><Menu
    open={open && !disabled} portal autoFocus dense
    anchor={<Button variant="outline" disabled={disabled} className="us-select" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span id={`${id}-value`}>{options.find(option => option.id === value)?.label ?? value}</span>
      <svg className="us-select-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </Button>}
    selectedId={value} items={options} onClose={() => setOpen(false)} onSelect={next => { onChange(next); setOpen(false) }}
  /></div>
}
function NumberField({ name, value, min = 1, max, step = 1, disabled, onChange, title, hint, optional = false, placeholder }) {
  return <div className="us-field us-field-number"><label htmlFor={name}>{title}</label><Input id={name} type="number" min={min} max={max} step={step} value={value ?? ''} placeholder={placeholder} disabled={disabled} onChange={event => onChange(event.target.value === '' ? (optional ? null : '') : Number(event.target.value))} />{hint && <small>{hint}</small>}</div>
}
function Toggle({ checked, title, disabled, onChange }) {
  return <div className="us-field us-field-toggle"><span className="us-field-title">{title}</span><div className="us-toggle-control"><Switch checked={checked} label={title} disabled={disabled} onChange={onChange} /></div></div>
}

export function SettingsPage(props) {
  const { t, useSearchEditor, edit, addKey, editKey, removeKey, save, discard, rebase } = props
  const state = useSearchEditor(value => value)
  const [activeProvider, setActiveProvider] = useState('tavily')
  if (props.view === 'summary') return <span>{t('summary')}</span>
  if (!state.available || !state.values) return <p className="us-muted">{t(state.status === 'loading' ? 'loading' : 'unavailable')}</p>
  const disabled = state.saving || !state.writable
  const providerOptions = providerNames.map(id => ({ id, label: label[id] }))
  const choices = values => values.map(id => ({ id, label: id }))
  const providerEdit = (provider, field, value) => edit(['providers', provider, field], value)
  return <div className="us-settings">
    <section className="us-defaults" aria-label={t('defaults')}>
      <div className="us-fields">
        <Select id="us-default-search" label={t('defaultSearch')} value={state.values.defaultSearchProvider} options={providerOptions} disabled={disabled} onChange={value => edit(['defaultSearchProvider'], value)} />
        <Select id="us-default-fetch" label={t('defaultFetch')} value={state.values.defaultFetchProvider} options={providerOptions} disabled={disabled} onChange={value => edit(['defaultFetchProvider'], value)} />
      </div><p className="us-hint">{t('defaultsHint')}</p>
    </section>
    {!state.writable && <p role="status" className="us-notice">{t('readOnly')}</p>}
    <div className="us-tabs" role="tablist" aria-label={t('providers')}>
      {providerNames.map((provider, index) => <Button key={provider} role="tab" id={`us-tab-${provider}`} aria-controls={`us-panel-${provider}`} aria-selected={activeProvider === provider} tabIndex={activeProvider === provider ? 0 : -1} className="us-tab" onClick={() => setActiveProvider(provider)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % providerNames.length : event.key === 'ArrowLeft' ? (index + providerNames.length - 1) % providerNames.length : event.key === 'Home' ? 0 : event.key === 'End' ? providerNames.length - 1 : undefined
        if (next === undefined) return
        event.preventDefault()
        setActiveProvider(providerNames[next])
        event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus()
      }}>{label[provider]}</Button>)}
    </div>
    {providerNames.filter(provider => provider === activeProvider).map(provider => {
      const config = state.values.providers[provider]
      const rows = state.rows[provider]
      const number = (field, options = {}) => <NumberField key={field} name={`us-${provider}-${field}`} title={t(field)} value={config[field]} disabled={disabled} onChange={value => providerEdit(provider, field, value)} {...options} />
      const select = (field, options) => <Select id={`us-${provider}-${field}`} label={t(field)} value={config[field]} options={choices(options)} disabled={disabled} onChange={value => providerEdit(provider, field, value)} />
      return <section className="us-provider" key={provider} id={`us-panel-${provider}`} role="tabpanel" aria-labelledby={`us-tab-${provider}`}>
        <div className="us-fields us-provider-main">
          {provider === 'tavily' && <>{select('searchDepth', ['advanced', 'basic', 'fast', 'ultra-fast'])}{select('extractDepth', ['advanced', 'basic'])}</>}
          {provider === 'exa' && <>{select('searchType', ['instant', 'fast', 'auto', 'deep-lite', 'deep', 'deep-reasoning'])}{select('searchContent', ['highlights', 'text'])}{number('maxAgeHours', { min: -1, max: 720, hint: t('maxAgeHint') })}</>}
          {provider === 'firecrawl' && <><Toggle checked={config.highlights} title={t('fireHighlights')} disabled={disabled} onChange={value => providerEdit(provider, 'highlights', value)} /><Toggle checked={config.onlyMainContent} title={t('onlyMainContent')} disabled={disabled} onChange={value => providerEdit(provider, 'onlyMainContent', value)} /></>}
        </div>
        <details className="us-details"><summary>{t('keys')} <span className="us-count">{rows.length}</span></summary>
          <div className="us-detail-body"><p className="us-hint">{t('keysHint')}</p>
            {rows.length === 0 && <p className="us-muted">{t('noKeys')}</p>}
            {rows.map((row, index) => {
              const info = state.infos[row.ref]
              return <div className="us-key" key={row.id}>
                <div className="us-key-head"><span className="us-key-index">{String(index + 1).padStart(2, '0')}</span><span className={info?.configured ? 'us-status-ready' : 'us-muted'}>{t(info ? info.configured ? 'configured' : 'missing' : 'checking')}{info?.writable === false ? ` · ${t('readOnlyKey')}` : ''}</span>
                  <Switch checked={row.enabled} label={`${label[provider]} ${index + 1}: ${t('enabled')}`} disabled={disabled} onChange={value => editKey(provider, row.id, 'enabled', value)} />
                  <Button size="sm" disabled={disabled} onClick={() => removeKey(provider, row.id)}>{t('remove')}</Button>
                </div>
                <div className="us-fields us-key-fields"><div className="us-field"><label htmlFor={`${row.id}-ref`}>{t('ref')}</label><Input id={`${row.id}-ref`} value={row.ref} disabled={disabled} spellCheck={false} autoComplete="off" onChange={event => editKey(provider, row.id, 'ref', event.target.value)} /></div>
                  <div className="us-field"><label htmlFor={`${row.id}-secret`}>{t('secret')}</label><Input id={`${row.id}-secret`} type="password" value={row.secret} disabled={disabled || info?.writable === false} autoComplete="new-password" placeholder={t('secretPlaceholder')} onChange={event => editKey(provider, row.id, 'secret', event.target.value)} /></div>
                </div>
              </div>
            })}
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => addKey(provider)}>{t('addKey')}</Button>
            <p className="us-hint">{t('refHint')} {t('removeHint')}</p>
          </div>
        </details>
        <details className="us-details"><summary>{t('advancedOptions')}</summary><div className="us-detail-body">
          {select('keyStrategy', ['round-robin', 'failover'])}<p className="us-hint">{t('rotationHint')}</p>
          <h4>{t('output')}</h4><div className="us-fields">{number('maxResults', { min: provider === 'tavily' ? 0 : 1, max: provider === 'tavily' ? 20 : 100, optional: true, placeholder: t('upstreamDefault') })}{number('snippetMaxChars', { optional: true, placeholder: t('noLocalLimit') })}{number('fetchMaxChars', { optional: true, placeholder: t('noLocalLimit') })}</div><p className="us-hint">{t('outputHint')}</p>
          {provider === 'tavily' && select('topic', ['general', 'news', 'finance'])}
          <h4>{t('timeouts')}</h4><div className="us-fields">{number('searchTimeoutMs')}{number('fetchTimeoutMs')}{provider === 'tavily' && number('extractTimeoutSeconds', { max: 60, step: 'any' })}{provider === 'firecrawl' && <>{number('searchApiTimeoutMs')}{number('scrapeApiTimeoutMs')}</>}</div><p className="us-hint">{t('timeoutHint')}</p>
        </div></details>
        {!rows.some(row => row.enabled) && <p className="us-hint">{t('emptyKeysWarning')}</p>}
      </section>
    })}
    <div className="us-footer">
      {(state.conflict || state.error?.kind === 'conflict') && <div className="us-notice" role="alert"><p>{t('conflict')}</p><p className="us-hint">{t('rebaseHint')}</p><div className="us-actions"><Button variant="outline" size="sm" disabled={disabled} onClick={rebase}>{t('rebase')}</Button><Button size="sm" disabled={disabled} onClick={discard}>{t('reload')}</Button></div></div>}
      {state.error && state.error.kind !== 'conflict' && <p className="us-error" role="alert">{t(state.error.kind)} {state.error.provider ? label[state.error.provider] : ''}{state.error.field ? ` · ${t(state.error.field)}` : ''}{state.error.ref ? ` · ${state.error.ref}` : ''}</p>}
      {state.error?.savedKeyRefs?.length > 0 && <p className="us-notice" role="alert">{t('partial')} {state.error.savedKeyRefs.join(', ')}</p>}
      <div className="us-actions"><Button variant="primary" disabled={disabled || !state.dirty || state.conflict || state.error?.kind === 'conflict'} onClick={() => void save()}>{t(state.saving ? 'saving' : 'save')}</Button><Button disabled={disabled || !state.dirty} onClick={discard}>{t('discard')}</Button><span className="us-muted" aria-live="polite">{state.saved ? t('saved') : state.dirty ? t('unsaved') : ''}</span></div>
    </div>
  </div>
}
