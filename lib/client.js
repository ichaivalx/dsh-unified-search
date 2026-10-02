window.__ModuleLoader__.load({ id: "@ichaival/dsh-unified-search", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/editor.js
var providerNames = ["tavily", "exa", "firecrawl"];
var clone = (value) => structuredClone(value);
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
var refPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
var optionalLimits = ["maxResults", "snippetMaxChars", "fetchMaxChars"];
var get = (object, path) => path.reduce((value, key) => value?.[key], object);
var put = (object, path, value) => {
  let target = object;
  for (const key of path.slice(0, -1)) target = target[key] ??= {};
  target[path.at(-1)] = value;
};
var SearchSettingsEditor = class {
  constructor({ scope, mutate, acceptView, credentials, createStore }) {
    this.scope = scope;
    this.mutate = mutate;
    this.acceptView = acceptView;
    this.credentials = credentials;
    this.edits = /* @__PURE__ */ new Map();
    this.rows = {};
    this.infos = {};
    this.serial = 0;
    this.saving = false;
    this.error = null;
    this.saved = false;
    this.disposed = false;
    this.readGeneration = 0;
    this.base = null;
    this.revision = void 0;
    this.store = createStore(this.project());
    this.unsubscribe = scope.subscribe(() => this.sync());
    this.sync();
  }
  dirty() {
    return this.edits.size > 0 || Object.values(this.rows).flat().some((row) => row.secret.length > 0);
  }
  values() {
    if (!this.base) return null;
    const values = clone(this.base);
    for (const { path, value } of this.edits.values()) put(values, path, clone(value));
    return values;
  }
  project() {
    const live = this.scope.getSnapshot();
    return {
      available: live.status === "ready" && !!live.value,
      status: live.status,
      writable: live.writable && live.mode !== "memory",
      values: this.values(),
      rows: clone(this.rows),
      infos: clone(this.infos),
      dirty: this.dirty(),
      saving: this.saving,
      error: this.error,
      saved: this.saved,
      conflict: this.dirty() && live.revision !== this.revision
    };
  }
  publish() {
    if (!this.disposed) this.store.set(this.project());
  }
  loadBaseline() {
    const live = this.scope.getSnapshot();
    if (!live.value) return;
    this.base = clone(live.value);
    this.revision = live.revision;
    this.rows = Object.fromEntries(providerNames.map((provider) => [
      provider,
      (this.base.providers?.[provider]?.keys ?? []).map((key) => ({ id: `key-${++this.serial}`, ref: key.ref, enabled: key.enabled, secret: "" }))
    ]));
  }
  sync() {
    if (this.disposed) return;
    if (!this.dirty() && !this.saving) this.loadBaseline();
    this.publish();
    void this.refreshCredentials();
  }
  edit(path, value) {
    if (this.saving || !this.base) return;
    if (path.length === 3 && path[0] === "providers" && optionalLimits.includes(path[2]) && (value == null || value === "")) value = null;
    const key = path.join(".");
    if (same(get(this.base, path), value)) this.edits.delete(key);
    else this.edits.set(key, { path: [...path], value: clone(value) });
    this.error = null;
    this.saved = false;
    this.publish();
  }
  stageRows(provider) {
    this.edit(["providers", provider, "keys"], this.rows[provider].map(({ ref, enabled }) => ({ ref, enabled })));
    void this.refreshCredentials();
  }
  addKey(provider) {
    if (this.saving || !this.base) return;
    const used = new Set(Object.values(this.rows).flat().map((row) => row.ref));
    const prefix = `${provider.toUpperCase()}_API_KEY`;
    let ref = prefix, suffix = 2;
    while (used.has(ref)) ref = `${prefix}_${suffix++}`;
    this.rows[provider].push({ id: `key-${++this.serial}`, ref, enabled: true, secret: "" });
    this.stageRows(provider);
  }
  editKey(provider, id, field, value) {
    if (this.saving) return;
    const row = this.rows[provider]?.find((item) => item.id === id);
    if (!row || !["ref", "enabled", "secret"].includes(field)) return;
    row[field] = value;
    if (field !== "secret") this.stageRows(provider);
    else {
      this.error = null;
      this.saved = false;
      this.publish();
    }
  }
  removeKey(provider, id) {
    if (this.saving) return;
    this.rows[provider] = this.rows[provider].filter((row) => row.id !== id);
    this.stageRows(provider);
  }
  discard() {
    if (this.saving) return;
    this.edits.clear();
    this.error = null;
    this.saved = false;
    this.loadBaseline();
    this.publish();
    void this.refreshCredentials(true);
  }
  rebase() {
    if (this.saving) return;
    const live = this.scope.getSnapshot();
    if (!live.value) return;
    const stagedRows = this.rows;
    this.loadBaseline();
    for (const provider of providerNames) {
      if (this.edits.has(`providers.${provider}.keys`)) this.rows[provider] = stagedRows[provider];
      else {
        for (const row of this.rows[provider]) {
          row.secret = stagedRows[provider]?.find((old) => old.ref === row.ref)?.secret ?? "";
        }
        const restored = stagedRows[provider]?.filter((old) => old.secret && !this.rows[provider].some((row) => row.ref === old.ref)) ?? [];
        if (restored.length) {
          this.rows[provider].push(...restored);
          const path = ["providers", provider, "keys"];
          this.edits.set(path.join("."), { path, value: this.rows[provider].map(({ ref, enabled }) => ({ ref, enabled })) });
        }
      }
    }
    this.error = null;
    this.saved = false;
    this.publish();
    void this.refreshCredentials(true);
  }
  async refreshCredentials(force = false) {
    if (this.disposed) return;
    const refs = [...new Set(Object.values(this.rows).flat().map((row) => row.ref).filter((ref) => refPattern.test(ref)))];
    const signature = refs.join("\0");
    if (!force && signature === this.lastRefs) return;
    this.lastRefs = signature;
    const generation = ++this.readGeneration;
    try {
      const infos = {};
      for (let offset = 0; offset < refs.length; offset += 64) {
        const response = await this.credentials.describe(refs.slice(offset, offset + 64));
        if (!response.ok) throw new Error("credential-status");
        Object.assign(infos, response.value);
      }
      if (!this.disposed && generation === this.readGeneration) this.infos = infos;
    } catch {
      if (generation === this.readGeneration) this.lastRefs = void 0;
    }
    this.publish();
  }
  validationError() {
    const values = this.values();
    for (const provider of providerNames) {
      const keys = this.rows[provider] ?? [];
      if (keys.some((row) => !refPattern.test(row.ref))) return { kind: "invalidRef", provider };
      if (new Set(keys.map((row) => row.ref)).size !== keys.length) return { kind: "duplicateRef", provider };
      const config = values.providers[provider];
      for (const field of ["searchTimeoutMs", "fetchTimeoutMs", "snippetMaxChars", "fetchMaxChars", "maxResults", ...provider === "firecrawl" ? ["searchApiTimeoutMs", "scrapeApiTimeoutMs"] : []]) {
        const number = config[field];
        if (optionalLimits.includes(field) && number == null) continue;
        const minimum = provider === "tavily" && field === "maxResults" ? 0 : 1;
        const maximum = field === "maxResults" ? provider === "tavily" ? 20 : 100 : Number.MAX_SAFE_INTEGER;
        if (!Number.isSafeInteger(number) || number < minimum || number > maximum) return { kind: "invalidNumber", provider, field };
      }
      if (provider === "tavily" && (!Number.isFinite(config.extractTimeoutSeconds) || config.extractTimeoutSeconds < 1 || config.extractTimeoutSeconds > 60)) return { kind: "invalidNumber", provider, field: "extractTimeoutSeconds" };
      if (provider === "exa" && (!Number.isInteger(config.maxAgeHours) || config.maxAgeHours < -1 || config.maxAgeHours > 720)) return { kind: "invalidNumber", provider, field: "maxAgeHours" };
    }
    const secrets = /* @__PURE__ */ new Map();
    for (const row of Object.values(this.rows).flat()) {
      if (!row.secret) continue;
      if (secrets.has(row.ref) && secrets.get(row.ref) !== row.secret) return { kind: "duplicateSecret", ref: row.ref };
      secrets.set(row.ref, row.secret);
    }
    return null;
  }
  async save() {
    const live = this.scope.getSnapshot();
    if (this.saving || !this.dirty() || !this.base || !live.writable || live.mode === "memory") return;
    this.error = this.validationError();
    if (!this.error && (live.revision !== this.revision || this.revision === void 0)) this.error = { kind: "conflict" };
    if (this.error) {
      this.publish();
      return;
    }
    this.saving = true;
    this.saved = false;
    const savedKeyRefs = [];
    let stage = "keys";
    let activeRef;
    try {
      const pending = new Map(Object.values(this.rows).flat().filter((row) => row.secret).map((row) => [row.ref, row.secret]));
      for (const [ref, value] of pending) {
        activeRef = ref;
        const response = await this.credentials.set(ref, value);
        if (!response.ok) throw { kind: "keyWrite", ref };
        savedKeyRefs.push(ref);
        for (const row of Object.values(this.rows).flat()) if (row.ref === ref) row.secret = "";
      }
      stage = "settings";
      const ops = [...this.edits.values()].map(({ path, value }) => ({ op: "set", path, value: clone(value) }));
      if (ops.length) {
        const response = await this.mutate(ops, this.revision);
        if (!response.ok) throw { kind: response.error?.code === "settings/conflict" ? "conflict" : "settingsWrite" };
        this.acceptView(response.value);
      }
      this.edits.clear();
      this.loadBaseline();
      this.error = null;
      this.saved = true;
    } catch (error) {
      const kind = ["keyWrite", "settingsWrite", "conflict"].includes(error?.kind) ? error.kind : stage === "keys" ? "keyWrite" : "settingsWrite";
      this.error = { kind, ...stage === "keys" ? { ref: activeRef } : {}, savedKeyRefs };
    } finally {
      this.saving = false;
      this.publish();
      await this.refreshCredentials(true);
    }
  }
  face() {
    return {
      hooks: { searchEditor: this.store },
      edit: (path, value) => this.edit(path, value),
      addKey: (provider) => this.addKey(provider),
      editKey: (provider, id, field, value) => this.editKey(provider, id, field, value),
      removeKey: (provider, id) => this.removeKey(provider, id),
      save: () => this.save(),
      discard: () => this.discard(),
      rebase: () => this.rebase()
    };
  }
  dispose() {
    this.disposed = true;
    this.unsubscribe();
    this.rows = {};
    this.edits.clear();
    this.readGeneration++;
  }
};

// src/client/index.jsx
var import_dsh_client_store = require("@deepseek-ai/dsh-client-store");

// src/client/Page.jsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime = require("react/jsx-runtime");
var label = { tavily: "Tavily", exa: "Exa", firecrawl: "Firecrawl" };
function Select({ id, label: title, value, options, disabled, onChange }) {
  const [open, setOpen] = (0, import_react.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-field us-field-select", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { id: `${id}-label`, children: title }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_dsh_client_ui_primitives.Menu,
      {
        open: open && !disabled,
        portal: true,
        autoFocus: true,
        dense: true,
        anchor: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_dsh_client_ui_primitives.Button, { variant: "outline", disabled, className: "us-select", "aria-labelledby": `${id}-label ${id}-value`, "aria-haspopup": "menu", "aria-expanded": open, onClick: () => setOpen(!open), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { id: `${id}-value`, children: options.find((option) => option.id === value)?.label ?? value }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { className: "us-select-arrow", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m4 6 4 4 4-4", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }) })
        ] }),
        selectedId: value,
        items: options,
        onClose: () => setOpen(false),
        onSelect: (next) => {
          onChange(next);
          setOpen(false);
        }
      }
    )
  ] });
}
function NumberField({ name, value, min = 1, max, step = 1, disabled, onChange, title, hint, optional = false, placeholder }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-field us-field-number", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: name, children: title }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { id: name, type: "number", min, max, step, value: value ?? "", placeholder, disabled, onChange: (event) => onChange(event.target.value === "" ? optional ? null : "" : Number(event.target.value)) }),
    hint && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: hint })
  ] });
}
function Toggle({ checked, title, disabled, onChange }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-field us-field-toggle", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "us-field-title", children: title }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "us-toggle-control", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Switch, { checked, label: title, disabled, onChange }) })
  ] });
}
function SettingsPage(props) {
  const { t, useSearchEditor, edit, addKey, editKey, removeKey, save, discard, rebase } = props;
  const state = useSearchEditor((value) => value);
  const [activeProvider, setActiveProvider] = (0, import_react.useState)("tavily");
  if (props.view === "summary") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("summary") });
  if (!state.available || !state.values) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "us-muted", children: t(state.status === "loading" ? "loading" : "unavailable") });
  const disabled = state.saving || !state.writable;
  const providerOptions = providerNames.map((id) => ({ id, label: label[id] }));
  const choices = (values) => values.map((id) => ({ id, label: id }));
  const providerEdit = (provider, field, value) => edit(["providers", provider, field], value);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-settings", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "us-defaults", "aria-label": t("defaults"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-fields", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Select, { id: "us-default-search", label: t("defaultSearch"), value: state.values.defaultSearchProvider, options: providerOptions, disabled, onChange: (value) => edit(["defaultSearchProvider"], value) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Select, { id: "us-default-fetch", label: t("defaultFetch"), value: state.values.defaultFetchProvider, options: providerOptions, disabled, onChange: (value) => edit(["defaultFetchProvider"], value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "us-hint", children: t("defaultsHint") })
    ] }),
    !state.writable && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", className: "us-notice", children: t("readOnly") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "us-tabs", role: "tablist", "aria-label": t("providers"), children: providerNames.map((provider, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { role: "tab", id: `us-tab-${provider}`, "aria-controls": `us-panel-${provider}`, "aria-selected": activeProvider === provider, tabIndex: activeProvider === provider ? 0 : -1, className: "us-tab", onClick: () => setActiveProvider(provider), onKeyDown: (event) => {
      const next = event.key === "ArrowRight" ? (index + 1) % providerNames.length : event.key === "ArrowLeft" ? (index + providerNames.length - 1) % providerNames.length : event.key === "Home" ? 0 : event.key === "End" ? providerNames.length - 1 : void 0;
      if (next === void 0) return;
      event.preventDefault();
      setActiveProvider(providerNames[next]);
      event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
    }, children: label[provider] }, provider)) }),
    providerNames.filter((provider) => provider === activeProvider).map((provider) => {
      const config = state.values.providers[provider];
      const rows = state.rows[provider];
      const number = (field, options = {}) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NumberField, { name: `us-${provider}-${field}`, title: t(field), value: config[field], disabled, onChange: (value) => providerEdit(provider, field, value), ...options }, field);
      const select = (field, options) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Select, { id: `us-${provider}-${field}`, label: t(field), value: config[field], options: choices(options), disabled, onChange: (value) => providerEdit(provider, field, value) });
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "us-provider", id: `us-panel-${provider}`, role: "tabpanel", "aria-labelledby": `us-tab-${provider}`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-fields us-provider-main", children: [
          provider === "tavily" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            select("searchDepth", ["advanced", "basic", "fast", "ultra-fast"]),
            select("extractDepth", ["advanced", "basic"])
          ] }),
          provider === "exa" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            select("searchType", ["instant", "fast", "auto", "deep-lite", "deep", "deep-reasoning"]),
            select("searchContent", ["highlights", "text"]),
            number("maxAgeHours", { min: -1, max: 720, hint: t("maxAgeHint") })
          ] }),
          provider === "firecrawl" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, { checked: config.highlights, title: t("fireHighlights"), disabled, onChange: (value) => providerEdit(provider, "highlights", value) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toggle, { checked: config.onlyMainContent, title: t("onlyMainContent"), disabled, onChange: (value) => providerEdit(provider, "onlyMainContent", value) })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "us-details", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", { children: [
            t("keys"),
            " ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "us-count", children: rows.length })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-detail-body", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "us-hint", children: t("keysHint") }),
            rows.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "us-muted", children: t("noKeys") }),
            rows.map((row, index) => {
              const info = state.infos[row.ref];
              return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-key", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-key-head", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "us-key-index", children: String(index + 1).padStart(2, "0") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: info?.configured ? "us-status-ready" : "us-muted", children: [
                    t(info ? info.configured ? "configured" : "missing" : "checking"),
                    info?.writable === false ? ` \xB7 ${t("readOnlyKey")}` : ""
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Switch, { checked: row.enabled, label: `${label[provider]} ${index + 1}: ${t("enabled")}`, disabled, onChange: (value) => editKey(provider, row.id, "enabled", value) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", disabled, onClick: () => removeKey(provider, row.id), children: t("remove") })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-fields us-key-fields", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-field", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: `${row.id}-ref`, children: t("ref") }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { id: `${row.id}-ref`, value: row.ref, disabled, spellCheck: false, autoComplete: "off", onChange: (event) => editKey(provider, row.id, "ref", event.target.value) })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-field", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: `${row.id}-secret`, children: t("secret") }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { id: `${row.id}-secret`, type: "password", value: row.secret, disabled: disabled || info?.writable === false, autoComplete: "new-password", placeholder: t("secretPlaceholder"), onChange: (event) => editKey(provider, row.id, "secret", event.target.value) })
                  ] })
                ] })
              ] }, row.id);
            }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", disabled, onClick: () => addKey(provider), children: t("addKey") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "us-hint", children: [
              t("refHint"),
              " ",
              t("removeHint")
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "us-details", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: t("advancedOptions") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-detail-body", children: [
            select("keyStrategy", ["round-robin", "failover"]),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "us-hint", children: t("rotationHint") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: t("output") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-fields", children: [
              number("maxResults", { min: provider === "tavily" ? 0 : 1, max: provider === "tavily" ? 20 : 100, optional: true, placeholder: t("upstreamDefault") }),
              number("snippetMaxChars", { optional: true, placeholder: t("noLocalLimit") }),
              number("fetchMaxChars", { optional: true, placeholder: t("noLocalLimit") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "us-hint", children: t("outputHint") }),
            provider === "tavily" && select("topic", ["general", "news", "finance"]),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: t("timeouts") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-fields", children: [
              number("searchTimeoutMs"),
              number("fetchTimeoutMs"),
              provider === "tavily" && number("extractTimeoutSeconds", { max: 60, step: "any" }),
              provider === "firecrawl" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                number("searchApiTimeoutMs"),
                number("scrapeApiTimeoutMs")
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "us-hint", children: t("timeoutHint") })
          ] })
        ] }),
        !rows.some((row) => row.enabled) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "us-hint", children: t("emptyKeysWarning") })
      ] }, provider);
    }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-footer", children: [
      (state.conflict || state.error?.kind === "conflict") && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-notice", role: "alert", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("conflict") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "us-hint", children: t("rebaseHint") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", disabled, onClick: rebase, children: t("rebase") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", disabled, onClick: discard, children: t("reload") })
        ] })
      ] }),
      state.error && state.error.kind !== "conflict" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "us-error", role: "alert", children: [
        t(state.error.kind),
        " ",
        state.error.provider ? label[state.error.provider] : "",
        state.error.field ? ` \xB7 ${t(state.error.field)}` : "",
        state.error.ref ? ` \xB7 ${state.error.ref}` : ""
      ] }),
      state.error?.savedKeyRefs?.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "us-notice", role: "alert", children: [
        t("partial"),
        " ",
        state.error.savedKeyRefs.join(", ")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "us-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "primary", disabled: disabled || !state.dirty || state.conflict || state.error?.kind === "conflict", onClick: () => void save(), children: t(state.saving ? "saving" : "save") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { disabled: disabled || !state.dirty, onClick: discard, children: t("discard") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "us-muted", "aria-live": "polite", children: state.saved ? t("saved") : state.dirty ? t("unsaved") : "" })
      ] })
    ] })
  ] });
}

// src/client/locales.js
var namespace = "unified-search.settings";
var zh = {
  summary: "\u7EDF\u4E00\u8BBE\u7F6E\u641C\u7D22\u670D\u52A1\u3001\u7F51\u9875\u6B63\u6587\u8BFB\u53D6\u548C API \u5BC6\u94A5\u3002",
  providers: "\u641C\u7D22\u670D\u52A1\u914D\u7F6E",
  defaults: "\u9ED8\u8BA4\u670D\u52A1",
  defaultSearch: "\u9ED8\u8BA4\u641C\u7D22\u670D\u52A1",
  defaultFetch: "\u9ED8\u8BA4\u6B63\u6587\u8BFB\u53D6\u670D\u52A1",
  defaultsHint: "\u4E24\u9879\u72EC\u7ACB\u8BBE\u7F6E\uFF1B\u6A21\u578B\u672A\u6307\u5B9A\u670D\u52A1\u65F6\u4F7F\u7528\u8FD9\u91CC\u7684\u9009\u62E9\u3002",
  searchDepth: "\u641C\u7D22\u6863\u4F4D",
  extractDepth: "\u6B63\u6587\u8BFB\u53D6\u6863\u4F4D\uFF08Extract\uFF09",
  searchType: "\u641C\u7D22\u7C7B\u578B",
  searchContent: "\u641C\u7D22\u8FD4\u56DE\u5185\u5BB9",
  topic: "\u641C\u7D22\u7C7B\u522B",
  maxAgeHours: "\u6B63\u6587\u7F13\u5B58\uFF08Contents\uFF0C\u5C0F\u65F6\uFF09",
  maxAgeHint: "0 \u91CD\u65B0\u8BFB\u53D6\uFF1B-1 \u4EC5\u7528\u7F13\u5B58\uFF1B1\u2013720 \u4F7F\u7528\u4E0D\u8D85\u8FC7\u8BE5\u65F6\u957F\u7684\u7F13\u5B58\u3002",
  fireHighlights: "\u8FD4\u56DE\u76F8\u5173\u6458\u5F55\uFF08Search\uFF09",
  onlyMainContent: "\u4EC5\u4FDD\u7559\u6B63\u6587\uFF08Scrape\uFF09",
  keys: "API \u5BC6\u94A5",
  keysHint: "\u5BC6\u94A5\u4EC5\u5199\u5165 DSH \u51ED\u636E\u5E93\u3002\u8FD9\u91CC\u4E0D\u4F1A\u8BFB\u53D6\u6216\u663E\u793A\u5DF2\u4FDD\u5B58\u7684\u5BC6\u94A5\u3002",
  addKey: "\u6DFB\u52A0\u5BC6\u94A5",
  ref: "\u51ED\u636E\u540D\u79F0",
  refHint: "\u540D\u79F0\u53EF\u4FEE\u6539\uFF0C\u4F9B\u914D\u7F6E\u5F15\u7528\uFF1B\u4E0D\u662F\u5BC6\u94A5\u672C\u8EAB\u3002",
  secret: "\u586B\u5199\u6216\u66FF\u6362\u5BC6\u94A5",
  secretPlaceholder: "\u7559\u7A7A\u5219\u4FDD\u7559\u5DF2\u5B58\u5BC6\u94A5",
  enabled: "\u542F\u7528\u6B64\u5BC6\u94A5",
  remove: "\u79FB\u9664\u5F15\u7528",
  removeHint: "\u79FB\u9664\u53EA\u65AD\u5F00\u672C\u63D2\u4EF6\u7684\u5F15\u7528\uFF0C\u4E0D\u5220\u9664\u51ED\u636E\u5E93\u4E2D\u7684\u5171\u4EAB\u5BC6\u94A5\u3002",
  configured: "\u5DF2\u914D\u7F6E",
  missing: "\u672A\u914D\u7F6E",
  checking: "\u72B6\u6001\u672A\u77E5",
  readOnlyKey: "\u7531\u53EA\u8BFB\u6765\u6E90\u63D0\u4F9B",
  noKeys: "\u672A\u8BBE\u7F6E\u5BC6\u94A5\u5F15\u7528\u3002\u6DFB\u52A0\u4E00\u628A\u540E\u5373\u53EF\u4F7F\u7528\u6B64\u670D\u52A1\u3002",
  advancedOptions: "\u9AD8\u7EA7\u9009\u9879",
  output: "\u7ED3\u679C\u4E0E\u8F93\u51FA",
  timeouts: "\u8BF7\u6C42\u671F\u9650",
  keyStrategy: "\u591A\u5BC6\u94A5\u9009\u62E9",
  rotationHint: "\u8F6E\u8BE2\u5206\u914D\u8BF7\u6C42\uFF1B\u4E3B\u5907\u4F18\u5148\u7B2C\u4E00\u628A\u3002\u4EC5\u8BA4\u8BC1\u3001\u989D\u5EA6\u6216\u9650\u6D41\u9519\u8BEF\u624D\u5C1D\u8BD5\u4E0B\u4E00\u628A\uFF0C\u4E0D\u81EA\u52A8\u91CD\u8BD5\u7F51\u7EDC\u5931\u8D25\u6216\u8D85\u65F6\u3002",
  maxResults: "\u9ED8\u8BA4\u641C\u7D22\u7ED3\u679C\u6570",
  snippetMaxChars: "\u6BCF\u6761\u6458\u8981\u6700\u591A\u5B57\u7B26",
  fetchMaxChars: "\u6B63\u6587\u6700\u591A\u5B57\u7B26",
  searchTimeoutMs: "\u641C\u7D22\u603B\u671F\u9650\uFF08\u6BEB\u79D2\uFF09",
  fetchTimeoutMs: "\u6B63\u6587\u8BFB\u53D6\u603B\u671F\u9650\uFF08\u6BEB\u79D2\uFF09",
  extractTimeoutSeconds: "Tavily \u8BFB\u53D6\u671F\u9650\uFF08\u79D2\uFF09",
  searchApiTimeoutMs: "Firecrawl \u641C\u7D22\u671F\u9650\uFF08\u6BEB\u79D2\uFF09",
  scrapeApiTimeoutMs: "Firecrawl \u8BFB\u53D6\u671F\u9650\uFF08\u6BEB\u79D2\uFF09",
  upstreamDefault: "\u4E0A\u6E38\u9ED8\u8BA4",
  noLocalLimit: "\u4E0D\u989D\u5916\u622A\u65AD",
  outputHint: "\u7559\u7A7A\uFF1A\u7ED3\u679C\u6570\u4E0D\u4F20\u7ED9\u670D\u52A1\u5546\uFF0C\u6458\u8981\u548C\u6B63\u6587\u4E0D\u989D\u5916\u622A\u65AD\u3002\u586B\u5199\u6570\u503C\u624D\u5E94\u7528\uFF1BDSH \u4ECD\u4F1A\u5904\u7406\u8FC7\u957F\u8F93\u51FA\u3002",
  timeoutHint: "\u603B\u671F\u9650\u5E94\u4E3A\u670D\u52A1\u7AEF\u5904\u7406\u548C\u7F51\u7EDC\u4F20\u8F93\u7559\u51FA\u65F6\u95F4\u3002",
  save: "\u4FDD\u5B58\u66F4\u6539",
  saving: "\u6B63\u5728\u4FDD\u5B58\u2026",
  discard: "\u53D6\u6D88\u66F4\u6539",
  saved: "\u5DF2\u4FDD\u5B58\uFF0C\u4E0B\u4E00\u6B21\u8BF7\u6C42\u751F\u6548\u3002",
  unsaved: "\u6709\u672A\u4FDD\u5B58\u7684\u66F4\u6539",
  loading: "\u6B63\u5728\u8BFB\u53D6\u914D\u7F6E\u2026",
  unavailable: "\u5F53\u524D Host \u672A\u63D0\u4F9B\u7EDF\u4E00\u641C\u7D22\u914D\u7F6E\u3002\u8BF7\u786E\u8BA4\u63D2\u4EF6\u5DF2\u542F\u7528\u3002",
  readOnly: "\u5F53\u524D\u8FDE\u63A5\u4E0D\u80FD\u4FEE\u6539 Host \u914D\u7F6E\u3002",
  conflict: "\u914D\u7F6E\u5DF2\u5728\u5176\u4ED6\u4F4D\u7F6E\u4FEE\u6539\u3002\u8349\u7A3F\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u8F7D\u5165\u6700\u65B0\u914D\u7F6E\uFF0C\u6216\u4FDD\u7559\u4F60\u7684\u6539\u52A8\u540E\u91CD\u65B0\u68C0\u67E5\u3002",
  rebase: "\u4FDD\u7559\u6211\u7684\u6539\u52A8\uFF0C\u91CD\u65B0\u68C0\u67E5",
  reload: "\u4E22\u5F03\u8349\u7A3F\uFF0C\u8F7D\u5165\u6700\u65B0",
  rebaseHint: "\u4FDD\u7559\u6539\u52A8\u540E\uFF0C\u540C\u4E00\u5B57\u6BB5\u5C06\u91C7\u7528\u4F60\u7684\u8349\u7A3F\uFF1B\u672A\u7F16\u8F91\u5B57\u6BB5\u4F7F\u7528\u6700\u65B0\u914D\u7F6E\u3002\u8BF7\u68C0\u67E5\u540E\u518D\u4FDD\u5B58\u3002",
  invalidRef: "\u51ED\u636E\u540D\u79F0\u9700\u4EE5\u5B57\u6BCD\u6216\u4E0B\u5212\u7EBF\u5F00\u5934\uFF0C\u53EA\u80FD\u5305\u542B\u5B57\u6BCD\u3001\u6570\u5B57\u548C\u4E0B\u5212\u7EBF\u3002",
  duplicateRef: "\u540C\u4E00\u5BB6\u670D\u52A1\u4E2D\u4E0D\u80FD\u91CD\u590D\u5F15\u7528\u540C\u4E00\u4E2A\u51ED\u636E\u540D\u79F0\u3002",
  duplicateSecret: "\u540C\u4E00\u4E2A\u51ED\u636E\u540D\u79F0\u586B\u5199\u4E86\u4E0D\u540C\u5BC6\u94A5\uFF0C\u8BF7\u7EDF\u4E00\u540E\u518D\u4FDD\u5B58\u3002",
  invalidNumber: "\u8BF7\u68C0\u67E5\u6570\u5B57\u5B57\u6BB5\uFF1A\u7ED3\u679C\u6570\u548C\u5B57\u7B26\u4E0A\u9650\u53EF\u7559\u7A7A\uFF1B\u5DF2\u586B\u5199\u7684\u503C\u9700\u5728\u5141\u8BB8\u8303\u56F4\u5185\uFF0C\u5B57\u7B26\u4E0A\u9650\u548C\u8BF7\u6C42\u671F\u9650\u987B\u4E3A\u6B63\u6574\u6570\u3002",
  keyWrite: "\u5BC6\u94A5\u4FDD\u5B58\u5931\u8D25\uFF0C\u672A\u5B8C\u6210\u7684\u8349\u7A3F\u4ECD\u4FDD\u7559\u3002\u8BF7\u68C0\u67E5\u51ED\u636E\u662F\u5426\u53EF\u5199\u6216\u8FDE\u63A5\u662F\u5426\u6B63\u5E38\u3002",
  settingsWrite: "\u914D\u7F6E\u4FDD\u5B58\u5931\u8D25\uFF0C\u8349\u7A3F\u4ECD\u4FDD\u7559\u3002\u8BF7\u68C0\u67E5\u8F93\u5165\u6216\u7A0D\u540E\u91CD\u8BD5\u3002",
  partial: "\u90E8\u5206\u66F4\u6539\u5DF2\u4FDD\u5B58\uFF1A\u4EE5\u4E0B\u5BC6\u94A5\u5DF2\u5199\u5165\u51ED\u636E\u5E93\uFF0C\u4F46\u5176\u4F59\u66F4\u6539\u5C1A\u672A\u5168\u90E8\u63D0\u4EA4\u3002",
  emptyKeysWarning: "\u6B64\u670D\u52A1\u6CA1\u6709\u542F\u7528\u7684\u5BC6\u94A5\uFF0C\u8C03\u7528\u65F6\u5C06\u65E0\u6CD5\u4F7F\u7528\u3002"
};
var en = {
  summary: "Configure unified web search, page reading, and API keys.",
  providers: "Search provider settings",
  defaults: "Default services",
  defaultSearch: "Default search provider",
  defaultFetch: "Default page-reading provider",
  defaultsHint: "Independent defaults used when the model omits a provider.",
  searchDepth: "Search depth",
  extractDepth: "Page-reading depth (Extract)",
  searchType: "Search type",
  searchContent: "Search content",
  topic: "Search topic",
  maxAgeHours: "Page cache age (Contents, hours)",
  maxAgeHint: "0 fetches fresh; -1 uses cache only; 1\u2013720 accepts cached content up to that age.",
  fireHighlights: "Return highlights (Search)",
  onlyMainContent: "Main content only (Scrape)",
  keys: "API keys",
  keysHint: "Keys are written only to DSH credentials. Saved secret values are never read or displayed.",
  addKey: "Add key",
  ref: "Credential name",
  refHint: "Editable configuration reference, not the secret itself.",
  secret: "Enter or replace key",
  secretPlaceholder: "Leave blank to retain the stored key",
  enabled: "Enable this key",
  remove: "Remove reference",
  removeHint: "Removing a reference does not delete the shared stored credential.",
  configured: "Configured",
  missing: "Not configured",
  checking: "Status unknown",
  readOnlyKey: "Provided by a read-only source",
  noKeys: "No key references. Add one to use this service.",
  advancedOptions: "Advanced options",
  output: "Results and output",
  timeouts: "Request deadlines",
  keyStrategy: "Key selection",
  rotationHint: "Rotate requests, or prefer the first key. Only authentication, quota, and rate-limit failures move to another key; network failures and timeouts are not retried.",
  maxResults: "Default search results",
  snippetMaxChars: "Maximum characters per snippet",
  fetchMaxChars: "Maximum page characters",
  searchTimeoutMs: "Search deadline (ms)",
  fetchTimeoutMs: "Page-read deadline (ms)",
  extractTimeoutSeconds: "Tavily extraction timeout (seconds)",
  searchApiTimeoutMs: "Firecrawl search timeout (ms)",
  scrapeApiTimeoutMs: "Firecrawl scrape timeout (ms)",
  upstreamDefault: "API default",
  noLocalLimit: "No local limit",
  outputHint: "Blank leaves the result count to the provider and adds no snippet or page truncation. Limits apply only when filled in; DSH still handles long output.",
  timeoutHint: "Allow room for provider processing and network transfer.",
  save: "Save changes",
  saving: "Saving\u2026",
  discard: "Cancel changes",
  saved: "Saved. Applies to the next request.",
  unsaved: "Unsaved changes",
  loading: "Loading settings\u2026",
  unavailable: "This Host does not expose unified-search settings. Check that the plugin is enabled.",
  readOnly: "This connection cannot change Host settings.",
  conflict: "Settings changed elsewhere. Your draft is retained. Reload the latest settings or keep your edits and review them again.",
  rebase: "Keep my edits and review again",
  reload: "Discard draft and reload",
  rebaseHint: "Your edits win on the same fields; untouched fields use the latest settings. Review before saving.",
  invalidRef: "Credential names must start with a letter or underscore, followed by letters, digits, or underscores.",
  duplicateRef: "A provider cannot list the same credential name twice.",
  duplicateSecret: "Different secrets were entered for the same credential name.",
  invalidNumber: "Result count and character limits may be blank. Entered values must be in range; character limits and deadlines must be positive integers.",
  keyWrite: "A key could not be saved. Unfinished drafts are retained. Check write access or connectivity.",
  settingsWrite: "Settings could not be saved. Your draft is retained; check the values or retry later.",
  partial: "Partially saved: these keys reached the credential store, but remaining changes have not all been committed.",
  emptyKeysWarning: "No keys are enabled; requests to this provider will be unavailable."
};

// src/client/style.css
var style_default = '.us-settings { color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; width: 100%; }\n.us-settings * { box-sizing: border-box; }\n.us-fields { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 18px 28px; }\n.us-defaults { padding: 4px 0 14px; }\n.us-field { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; max-width: 100%; }\n.us-field label, .us-field-title { font-weight: 500; }\n.us-field > small { max-width: 250px; }\n.us-field-number > span { width: 128px; max-width: 100%; }\n.us-field-select > span { max-width: 100%; }\n.us-key-fields .us-field { flex: 0 1 280px; }\n.us-key-fields .us-field > span { width: 100%; }\n.us-select { min-width: 148px; max-width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 20px; border-radius: 8px; }\n.us-select > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.us-select-arrow { display: block; width: 14px; height: 14px; flex: 0 0 14px; }\n.us-select[aria-expanded="true"] .us-select-arrow { transform: rotate(180deg); }\n.us-tabs { display: flex; gap: 26px; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n.us-tab { flex: 0 0 auto; padding: 0 2px; border-radius: 0; border-bottom: 2px solid transparent; color: var(--dsw-alias-label-tertiary); }\n.us-tab[aria-selected="true"] { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-label-primary); }\n.us-provider { padding: 20px 0 8px; }\n.us-actions, .us-key-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }\n.us-settings h4 { margin: 0 0 10px; font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); }\n.us-settings small, .us-hint, .us-muted { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.65; }\n.us-hint { margin: 10px 0; }\n.us-toggle-control { display: flex; align-items: center; min-height: 36px; }\n.us-details { margin-top: 12px; }\n.us-details > summary { cursor: pointer; color: var(--dsw-alias-label-secondary); padding: 8px 0; font-size: 12px; font-weight: 500; }\n.us-details > summary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 3px; border-radius: 4px; }\n.us-count { margin-left: 6px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }\n.us-detail-body { padding: 2px 0 8px; }\n.us-detail-body > h4 { margin-top: 20px; }\n.us-key { background: var(--dsw-alias-bg-layer-4); border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; padding: 12px; margin: 10px 0; }\n.us-key-head { margin-bottom: 10px; }\n.us-key-head > :nth-child(2) { flex: 1; }\n.us-key-index { font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }\n.us-status-ready { color: var(--dsw-alias-label-secondary); font-size: 12px; }\n.us-footer { padding: 14px 0 10px; margin-top: 12px; border-top: 1px solid var(--dsw-alias-border-l2); }\n.us-notice { padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-4); margin: 0 0 12px; font-size: 12px; }\n.us-notice > p:first-child { margin-top: 0; }\n.us-error { color: var(--dsw-alias-label-error); margin: 0 0 12px; font-size: 12px; }\n@media (max-width: 640px) { .us-fields { gap: 16px 20px; } .us-tabs { gap: 20px; } }\n';

// src/client/index.jsx
var inject = ["slots", "locale", "remote", "remote.settings", "remote.credentials", "configForms"];
function apply(ctx) {
  const scope = ctx.configForms.get("unified-search");
  const editor = new SearchSettingsEditor({
    scope,
    createStore: import_dsh_client_store.createSnapshotStore,
    mutate: (ops, revision) => ctx.remote.settings.mutate("unified-search", ops, revision),
    acceptView: (view) => ctx.configForms.describe().acceptView(view),
    credentials: {
      describe: (refs) => ctx.remote.credentials.describe(refs),
      set: (ref, value) => ctx.remote.credentials.set(ref, value)
    }
  });
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), "unified-search dictionaries");
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "@ichaival/dsh-unified-search";
    style.textContent = style_default;
    document.head.append(style);
    return () => style.remove();
  }, "unified-search styles");
  ctx.effect(() => ctx.remote.$on("credentials/reference-updated", () => {
    void editor.refreshCredentials(true);
  }), "unified-search credential status");
  ctx.effect(() => ctx.on("connection/reset", () => {
    void editor.refreshCredentials(true);
  }), "unified-search reconnect");
  ctx.effect(() => () => editor.dispose(), "unified-search editor");
  ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
    name: "plugins.bundle.config",
    key: "@ichaival/dsh-unified-search",
    locale: namespace,
    inject: () => editor.face()
  }, SettingsPage));
}
return module.exports; } });
//# sourceMappingURL=client.js.map
