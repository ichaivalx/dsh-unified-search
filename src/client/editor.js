export const providerNames = ['tavily', 'exa', 'firecrawl']
const clone = value => structuredClone(value)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const refPattern = /^[A-Za-z_][A-Za-z0-9_]*$/
const optionalLimits = ['maxResults', 'snippetMaxChars', 'fetchMaxChars']
const get = (object, path) => path.reduce((value, key) => value?.[key], object)
const put = (object, path, value) => {
  let target = object
  for (const key of path.slice(0, -1)) target = target[key] ??= {}
  target[path.at(-1)] = value
}

/** Private editor controller, following DSH's configuration-card pattern.
 * The settings scope remains the live data owner; this controller holds drafts.
 * Credentials are write-only, transient draft values and never settings fields.
 */
export class SearchSettingsEditor {
  constructor({ scope, mutate, acceptView, credentials, createStore }) {
    this.scope = scope
    this.mutate = mutate
    this.acceptView = acceptView
    this.credentials = credentials
    this.edits = new Map()
    this.rows = {}
    this.infos = {}
    this.serial = 0
    this.saving = false
    this.error = null
    this.saved = false
    this.disposed = false
    this.readGeneration = 0
    this.base = null
    this.revision = undefined
    this.store = createStore(this.project())
    this.unsubscribe = scope.subscribe(() => this.sync())
    this.sync()
  }

  dirty() { return this.edits.size > 0 || Object.values(this.rows).flat().some(row => row.secret.length > 0) }
  values() {
    if (!this.base) return null
    const values = clone(this.base)
    for (const { path, value } of this.edits.values()) put(values, path, clone(value))
    return values
  }
  project() {
    const live = this.scope.getSnapshot()
    return {
      available: live.status === 'ready' && !!live.value,
      status: live.status,
      writable: live.writable && live.mode !== 'memory',
      values: this.values(), rows: clone(this.rows), infos: clone(this.infos),
      dirty: this.dirty(), saving: this.saving, error: this.error, saved: this.saved,
      conflict: this.dirty() && live.revision !== this.revision,
    }
  }
  publish() { if (!this.disposed) this.store.set(this.project()) }
  loadBaseline() {
    const live = this.scope.getSnapshot()
    if (!live.value) return
    this.base = clone(live.value)
    this.revision = live.revision
    this.rows = Object.fromEntries(providerNames.map(provider => [provider,
      (this.base.providers?.[provider]?.keys ?? []).map(key => ({ id: `key-${++this.serial}`, ref: key.ref, enabled: key.enabled, secret: '' })),
    ]))
  }
  sync() {
    if (this.disposed) return
    if (!this.dirty() && !this.saving) this.loadBaseline()
    this.publish()
    void this.refreshCredentials()
  }
  edit(path, value) {
    if (this.saving || !this.base) return
    if (path.length === 3 && path[0] === 'providers' && optionalLimits.includes(path[2]) && (value == null || value === '')) value = null
    const key = path.join('.')
    if (same(get(this.base, path), value)) this.edits.delete(key)
    else this.edits.set(key, { path: [...path], value: clone(value) })
    this.error = null
    this.saved = false
    this.publish()
  }
  stageRows(provider) {
    this.edit(['providers', provider, 'keys'], this.rows[provider].map(({ ref, enabled }) => ({ ref, enabled })))
    void this.refreshCredentials()
  }
  addKey(provider) {
    if (this.saving || !this.base) return
    const used = new Set(Object.values(this.rows).flat().map(row => row.ref))
    const prefix = `${provider.toUpperCase()}_API_KEY`
    let ref = prefix, suffix = 2
    while (used.has(ref)) ref = `${prefix}_${suffix++}`
    this.rows[provider].push({ id: `key-${++this.serial}`, ref, enabled: true, secret: '' })
    this.stageRows(provider)
  }
  editKey(provider, id, field, value) {
    if (this.saving) return
    const row = this.rows[provider]?.find(item => item.id === id)
    if (!row || !['ref', 'enabled', 'secret'].includes(field)) return
    row[field] = value
    if (field !== 'secret') this.stageRows(provider)
    else { this.error = null; this.saved = false; this.publish() }
  }
  removeKey(provider, id) {
    if (this.saving) return
    this.rows[provider] = this.rows[provider].filter(row => row.id !== id)
    // Removing a reference never deletes the shared credentials record.
    this.stageRows(provider)
  }
  discard() {
    if (this.saving) return
    this.edits.clear()
    this.error = null
    this.saved = false
    this.loadBaseline()
    this.publish()
    void this.refreshCredentials(true)
  }
  rebase() {
    if (this.saving) return
    const live = this.scope.getSnapshot()
    if (!live.value) return
    const stagedRows = this.rows
    this.loadBaseline()
    for (const provider of providerNames) {
      if (this.edits.has(`providers.${provider}.keys`)) this.rows[provider] = stagedRows[provider]
      else {
        for (const row of this.rows[provider]) {
          row.secret = stagedRows[provider]?.find(old => old.ref === row.ref)?.secret ?? ''
        }
        // An external edit may have removed a reference with a password draft.
        // The explicit "keep my edits" action must retain that unfinished row.
        const restored = stagedRows[provider]?.filter(old => old.secret && !this.rows[provider].some(row => row.ref === old.ref)) ?? []
        if (restored.length) {
          this.rows[provider].push(...restored)
          const path = ['providers', provider, 'keys']
          this.edits.set(path.join('.'), { path, value: this.rows[provider].map(({ ref, enabled }) => ({ ref, enabled })) })
        }
      }
    }
    this.error = null
    this.saved = false
    this.publish()
    void this.refreshCredentials(true)
  }
  async refreshCredentials(force = false) {
    if (this.disposed) return
    const refs = [...new Set(Object.values(this.rows).flat().map(row => row.ref).filter(ref => refPattern.test(ref)))]
    const signature = refs.join('\0')
    if (!force && signature === this.lastRefs) return
    this.lastRefs = signature
    const generation = ++this.readGeneration
    try {
      const infos = {}
      // The public credentials.describe protocol accepts 64 refs per call.
      // Batching honors that API contract without limiting the number of keys.
      for (let offset = 0; offset < refs.length; offset += 64) {
        const response = await this.credentials.describe(refs.slice(offset, offset + 64))
        if (!response.ok) throw new Error('credential-status')
        Object.assign(infos, response.value)
      }
      if (!this.disposed && generation === this.readGeneration) this.infos = infos
    } catch {
      if (generation === this.readGeneration) this.lastRefs = undefined
    }
    this.publish()
  }
  validationError() {
    const values = this.values()
    for (const provider of providerNames) {
      const keys = this.rows[provider] ?? []
      if (keys.some(row => !refPattern.test(row.ref))) return { kind: 'invalidRef', provider }
      if (new Set(keys.map(row => row.ref)).size !== keys.length) return { kind: 'duplicateRef', provider }
      const config = values.providers[provider]
      for (const field of ['searchTimeoutMs', 'fetchTimeoutMs', 'snippetMaxChars', 'fetchMaxChars', 'maxResults', ...(provider === 'firecrawl' ? ['searchApiTimeoutMs', 'scrapeApiTimeoutMs'] : [])]) {
        const number = config[field]
        if (optionalLimits.includes(field) && number == null) continue
        const minimum = provider === 'tavily' && field === 'maxResults' ? 0 : 1
        const maximum = field === 'maxResults' ? (provider === 'tavily' ? 20 : 100) : Number.MAX_SAFE_INTEGER
        if (!Number.isSafeInteger(number) || number < minimum || number > maximum) return { kind: 'invalidNumber', provider, field }
      }
      if (provider === 'tavily' && (!Number.isFinite(config.extractTimeoutSeconds) || config.extractTimeoutSeconds < 1 || config.extractTimeoutSeconds > 60)) return { kind: 'invalidNumber', provider, field: 'extractTimeoutSeconds' }
      if (provider === 'exa' && (!Number.isInteger(config.maxAgeHours) || config.maxAgeHours < -1 || config.maxAgeHours > 720)) return { kind: 'invalidNumber', provider, field: 'maxAgeHours' }
    }
    const secrets = new Map()
    for (const row of Object.values(this.rows).flat()) {
      if (!row.secret) continue
      if (secrets.has(row.ref) && secrets.get(row.ref) !== row.secret) return { kind: 'duplicateSecret', ref: row.ref }
      secrets.set(row.ref, row.secret)
    }
    return null
  }
  async save() {
    const live = this.scope.getSnapshot()
    if (this.saving || !this.dirty() || !this.base || !live.writable || live.mode === 'memory') return
    this.error = this.validationError()
    if (!this.error && (live.revision !== this.revision || this.revision === undefined)) this.error = { kind: 'conflict' }
    if (this.error) { this.publish(); return }
    this.saving = true
    this.saved = false
    const savedKeyRefs = []
    let stage = 'keys'
    let activeRef
    try {
      const pending = new Map(Object.values(this.rows).flat().filter(row => row.secret).map(row => [row.ref, row.secret]))
      for (const [ref, value] of pending) {
        activeRef = ref
        const response = await this.credentials.set(ref, value)
        if (!response.ok) throw { kind: 'keyWrite', ref }
        savedKeyRefs.push(ref)
        for (const row of Object.values(this.rows).flat()) if (row.ref === ref) row.secret = ''
      }
      stage = 'settings'
      const ops = [...this.edits.values()].map(({ path, value }) => ({ op: 'set', path, value: clone(value) }))
      if (ops.length) {
        const response = await this.mutate(ops, this.revision)
        if (!response.ok) throw { kind: response.error?.code === 'settings/conflict' ? 'conflict' : 'settingsWrite' }
        this.acceptView(response.value)
      }
      this.edits.clear()
      this.loadBaseline()
      this.error = null
      this.saved = true
    } catch (error) {
      const kind = ['keyWrite', 'settingsWrite', 'conflict'].includes(error?.kind) ? error.kind : stage === 'keys' ? 'keyWrite' : 'settingsWrite'
      this.error = { kind, ...(stage === 'keys' ? { ref: activeRef } : {}), savedKeyRefs }
    } finally {
      this.saving = false
      this.publish()
      await this.refreshCredentials(true)
    }
  }
  face() {
    return {
      hooks: { searchEditor: this.store },
      edit: (path, value) => this.edit(path, value),
      addKey: provider => this.addKey(provider),
      editKey: (provider, id, field, value) => this.editKey(provider, id, field, value),
      removeKey: (provider, id) => this.removeKey(provider, id),
      save: () => this.save(), discard: () => this.discard(), rebase: () => this.rebase(),
    }
  }
  dispose() {
    this.disposed = true
    this.unsubscribe()
    this.rows = {}
    this.edits.clear()
    this.readGeneration++
  }
}
