import { SearchSettingsEditor } from './editor.js'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SettingsPage } from './Page.jsx'
import { namespace, zh, en } from './locales.js'
import css from './style.css'

export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'remote.credentials', 'settingsScope']

export function apply(ctx) {
  const scope = ctx.settingsScope.bind({ namespace: 'unified-search' })
  const editor = new SearchSettingsEditor({
    scope,
    createStore: createSnapshotStore,
    mutate: (ops, revision) => ctx.remote.settings.mutate('unified-search', ops, revision),
    acceptView: view => ctx.settingsScope.describe().acceptView(view),
    credentials: {
      describe: refs => ctx.remote.credentials.describe(refs),
      set: (ref, value) => ctx.remote.credentials.set(ref, value),
    },
  })
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'unified-search dictionaries')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@ichaival/dsh-unified-search'
    style.textContent = css
    document.head.append(style)
    return () => style.remove()
  }, 'unified-search styles')
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', () => { void editor.refreshCredentials(true) }), 'unified-search credential status')
  ctx.effect(() => ctx.on('connection/reset', () => { void editor.refreshCredentials(true) }), 'unified-search reconnect')
  ctx.effect(() => () => editor.dispose(), 'unified-search editor')
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: '@ichaival/dsh-unified-search', locale: namespace,
    inject: () => editor.face(),
  }, SettingsPage))
}
