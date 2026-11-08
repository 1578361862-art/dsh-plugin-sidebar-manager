/**
 * Sidebar Manager — Client half.
 *
 * Adds one row to the left sidebar's **More** menu and one dialog that lists the
 * panels registered on `sidebar.panellist`. From there a panel row can be shown
 * or hidden, moved, and placed into a named group. Hidden panels stay loaded:
 * this plugin only drives the sidebar's own pin list, and it persists the layout
 * through the Host half (`/sidebar-manager/config`).
 *
 * Ordering: the sidebar sorts its rows by the `order` option each plugin passed
 * to `slots.register`. There is no public API to change it, but the option
 * objects are plain and unfrozen, so the plugin writes the computed order back
 * onto them and asks the registry for one more sync by registering and dropping
 * a throwaway row. The sidebar re-sorts, React re-orders the keyed rows, and the
 * DOM never sees the scratch row. Those writes are page state: a plugin reload
 * restores its declared order, so every boot replays the saved layout.
 *
 * Groups: the shell has no section concept, so group captions are painted, not
 * owned — the first visible row of a named group gets a `data-sm-caption`
 * attribute and CSS draws the label above it. Rows themselves stay untouched;
 * React keeps its own children, and the plugin never inserts nodes into them.
 *
 * Hand-written bundle: the module system registers the factory below, and every
 * side effect of this file runs when the page materializes the plugin, not when
 * the script is fetched.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-sidebar-manager',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    const h = React.createElement
    const SlidersIcon = primitives.IconSlidersTwoOutlineRegular

    /**
     * The menu row primitive the shipped More menu uses. A plain menuitem button
     * stands in if a future primitives build renames it, so the manager stays
     * reachable instead of disappearing from the menu.
     */
    function FallbackMenuItem({ icon, onSelect, children }) {
      return h('button', { type: 'button', role: 'menuitem', className: 'sm-row', onClick: onSelect }, icon, h('span', { className: 'sm-label' }, children))
    }
    const MenuItem = typeof primitives.MenuItemButton === 'function' ? primitives.MenuItemButton : FallbackMenuItem

    /** Panels the sidebar refuses to unpin, and the fixed first row: never managed here. */
    const FIXED_PANEL = 'plugins'
    /** Section id standing for "not in any group". */
    const UNGROUPED = '__ungrouped__'
    /** Prefix of the synthetic panel row this plugin registers for each group. */
    const FOLDER_PREFIX = 'sm-group:'
    /** @param groupId - group id. @returns the panel id of its folder row. */
    function folderIdOf(groupId) {
      return FOLDER_PREFIX + groupId
    }
    /** Longest accepted group name. */
    const GROUP_NAME_LIMIT = 40
    /** Same-origin route owned by the Host half. */
    const CONFIG_ROUTE = 'sidebar-manager/config'
    const STYLE_TAG = '@local/dsh-sidebar-manager/sidebar.css'

    /** Absolute config URL: a reverse-proxied GUI keeps its directory prefix. */
    function route(path) {
      try {
        return new URL(path, document.baseURI).href
      } catch {
        return `/${path}`
      }
    }

    // ---------------------------------------------------------------------
    // styles
    // ---------------------------------------------------------------------

    const CSS = `
.sm-overlay{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.28));-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}
.sm-card{display:flex;flex-direction:column;width:min(520px,calc(100vw - 32px));max-height:min(78vh,680px);border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:0 24px 64px rgba(0,0,0,.22);overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.5}
.sm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 16px 12px}
.sm-title{font-size:15px;font-weight:600;letter-spacing:.01em}
.sm-sub{margin-top:2px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b6b6b)}
.sm-close{flex:none;width:26px;height:26px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b);font-size:18px;line-height:1;cursor:pointer}
.sm-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.sm-list{flex:1;min-height:0;overflow:auto;padding:2px 8px 10px}
.sm-sec{display:flex;align-items:center;gap:4px;padding:16px 6px 2px}
.sm-sec-name{flex:1;min-width:0;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8a8a8a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-sec-input{flex:1;min-width:0;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b);font:inherit;font-size:12px;font-weight:600;letter-spacing:.01em;padding:3px 4px;border-radius:6px;outline:none}
.sm-sec-input:focus{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#111)}
.sm-row{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:10px}
.sm-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.045))}
.sm-row[data-sm-visible="false"] .sm-label{color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.sm-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-select{flex:none;height:26px;max-width:118px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;font:inherit;font-size:12px;padding:0 4px}
.sm-icon{flex:none;width:24px;height:24px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b);cursor:pointer;font-size:12px;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0}
.sm-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08))}
.sm-icon:disabled{opacity:.28;cursor:default}
.sm-switch{flex:none;position:relative;width:34px;height:20px;border-radius:999px;border:none;padding:0;cursor:pointer;background:var(--dsw-alias-border-l3,rgba(0,0,0,.22));transition:background .15s ease}
.sm-switch[aria-checked="true"]{background:var(--dsw-alias-state-business-primary,#4d6bfe)}
.sm-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .15s ease}
.sm-switch[aria-checked="true"] .sm-knob{transform:translateX(14px)}
.sm-add{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;box-sizing:border-box;margin-top:12px;height:34px;border-radius:10px;border:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.18));background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b);font:inherit;font-size:13px;cursor:pointer}
.sm-add:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.045))}
.sm-empty{padding:24px 8px;text-align:center;color:var(--dsw-alias-label-secondary,#6b6b6b)}
.sm-foot{display:flex;align-items:center;gap:8px;padding:10px 16px 14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}
.sm-status{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary,#6b6b6b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-btn{height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer}
.sm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.sm-btn:disabled{opacity:.45;cursor:default}
.sm-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill,#1f1f1f);color:var(--dsw-alias-label-primary-inverted,#fff)}
.sm-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#333)}
/* Folder rows: one per group, drawn as a native row whose glyph toggles it.
   Members indent under an open folder; the hit layer owns the row's click. */
nav > button[data-sm-folder]{position:relative}
nav > button[data-sm-folder] > span:nth-child(2){font-weight:600}
/* The sidebar paints any row carrying aria-expanded as an open menu; a folder
   row is not that, so its resting fill stays transparent and hover is restored. */
nav > button[data-sm-folder][aria-expanded]{background-color:transparent}
@media (hover:hover){nav > button[data-sm-folder][aria-expanded]:hover{background-color:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}}
nav > button[data-sm-nested]{padding-left:30px}
.sm-folder-hit{position:absolute;inset:0;z-index:1;cursor:pointer}
.sm-chevron{display:inline-flex;align-items:center;justify-content:center;width:10px;height:10px;color:var(--dsw-alias-label-secondary,#6b6b6b);transform:rotate(90deg);transition:transform .12s ease}
.sm-chevron[data-open="false"]{transform:rotate(0deg)}
.sm-sec-toggle{width:22px;height:22px;margin-left:-2px}
.sm-sec-toggle svg{transform:rotate(90deg);transition:transform .12s ease}
.sm-sec-toggle[data-open="false"] svg{transform:rotate(0deg)}
@media (prefers-reduced-motion:reduce){.sm-switch,.sm-knob{transition:none}}
`

    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG)}]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-sidebar-manager'
      tag.dataset.pluginCss = STYLE_TAG
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ---------------------------------------------------------------------
    // copy
    // ---------------------------------------------------------------------

    const COPY = {
      en: {
        row: 'Manage sidebar entries…',
        title: 'Sidebar entries',
        sub: (shown, total) => `Showing ${shown} of ${total} · order and groups shape the sidebar`,
        close: 'Close',
        empty: 'No plugin has registered a sidebar entry yet',
        ungrouped: 'Ungrouped',
        newGroup: 'New group',
        showAll: 'Show all',
        done: 'Done',
        saving: 'Saving…',
        savedError: (error) => `Save failed: ${error}`,
        hint: 'Hides rows only — plugins stay loaded',
        hintStale: 'Hidden rows apply only after the next reload',
        moveUp: 'Move up',
        moveDown: 'Move down',
        moveSectionUp: 'Move group up',
        moveSectionDown: 'Move group down',
        deleteGroup: 'Delete group',
        groupName: 'Group name',
        groupTo: 'Move to group',
        showRow: 'Show row',
        hideRow: 'Hide row',
        defaultGroup: 'Group',
        expandGroup: 'Expand group',
        collapseGroup: 'Collapse group',
      },
      zh: {
        row: '管理侧栏入口…',
        title: '侧栏入口',
        sub: (shown, total) => `显示 ${shown} / ${total} 个 · 顺序与分组直接决定侧栏`,
        close: '关闭',
        empty: '还没有插件注册侧栏入口',
        ungrouped: '未分组',
        newGroup: '新建分组',
        showAll: '全部显示',
        done: '完成',
        saving: '保存中…',
        savedError: (error) => `保存失败：${error}`,
        hint: '只隐藏侧栏的行，不卸载插件',
        hintStale: '本次启动未能接管隐藏，重载页面后生效',
        moveUp: '上移',
        moveDown: '下移',
        moveSectionUp: '分组上移',
        moveSectionDown: '分组下移',
        deleteGroup: '删除分组',
        groupName: '分组名',
        groupTo: '移到分组',
        showRow: '显示该行',
        hideRow: '隐藏该行',
        defaultGroup: '分组',
        expandGroup: '展开分组',
        collapseGroup: '收起分组',
      },
    }

    /** Copy follows the page locale the rest of the shell is rendered in. */
    function copy() {
      const lang = typeof document === 'undefined' ? 'en' : String(document.documentElement.lang || 'en')
      return lang.toLowerCase().startsWith('zh') ? COPY.zh : COPY.en
    }

    // ---------------------------------------------------------------------
    // layout config
    // ---------------------------------------------------------------------

    /** Keep only meaningful, unique, non-fixed panel ids. */
    function cleanIds(value) {
      const out = []
      const seen = new Set()
      for (const raw of Array.isArray(value) ? value : []) {
        if (typeof raw !== 'string') continue
        const id = raw.trim()
        if (id === '' || id === FIXED_PANEL || seen.has(id)) continue
        seen.add(id)
        out.push(id)
      }
      return out
    }

    function defaultConfig() {
      return { version: 2, hidden: [], collapsed: [], groups: [], sections: [UNGROUPED], placement: {}, order: [] }
    }

    /**
     * Repair anything a hand edit, an older build, or a deleted group left
     * behind: unknown placements drop, sections are rebuilt from the groups that
     * exist, and the ungrouped bucket always exists exactly once.
     */
    function normalizeConfig(value) {
      const source = value !== null && typeof value === 'object' ? value : {}
      const groups = []
      for (const raw of Array.isArray(source.groups) ? source.groups : []) {
        if (raw === null || typeof raw !== 'object') continue
        const id = typeof raw.id === 'string' ? raw.id.trim() : ''
        if (id === '' || id === UNGROUPED || groups.some((group) => group.id === id)) continue
        const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, GROUP_NAME_LIMIT) : ''
        groups.push({ id, name: name === '' ? copy().defaultGroup : name })
      }
      const groupIds = new Set(groups.map((group) => group.id))

      const placement = {}
      if (source.placement !== null && typeof source.placement === 'object') {
        for (const [panel, groupId] of Object.entries(source.placement)) {
          if (typeof panel === 'string' && typeof groupId === 'string' && groupIds.has(groupId)) placement[panel] = groupId
        }
      }

      const sections = []
      for (const raw of Array.isArray(source.sections) ? source.sections : []) {
        if (typeof raw !== 'string') continue
        if (raw !== UNGROUPED && !groupIds.has(raw)) continue
        if (!sections.includes(raw)) sections.push(raw)
      }
      for (const group of groups) if (!sections.includes(group.id)) sections.push(group.id)
      if (!sections.includes(UNGROUPED)) sections.push(UNGROUPED)

      const collapsed = []
      for (const raw of Array.isArray(source.collapsed) ? source.collapsed : []) {
        if (typeof raw !== 'string' || !groupIds.has(raw) || collapsed.includes(raw)) continue
        collapsed.push(raw)
      }

      return {
        version: 2,
        hidden: cleanIds(source.hidden),
        collapsed,
        groups,
        sections,
        placement,
        order: cleanIds(source.order),
      }
    }

    /** Which group a panel belongs to, or UNGROUPED. */
    function sectionOf(config, id) {
      const placed = config.placement[id]
      return typeof placed === 'string' && config.groups.some((group) => group.id === placed) ? placed : UNGROUPED
    }

    /**
     * Rows in sidebar order: each group contributes its folder row, then its
     * members only while the folder is open. `panels` never contains folder ids.
     */
    function sequence(config, panels) {
      const rank = new Map(config.order.map((id, index) => [id, index]))
      const collapsed = new Set(config.collapsed)
      const orderOf = (id) => rank.get(id) ?? Number.MAX_SAFE_INTEGER
      const sections = config.sections.length > 0 ? config.sections : [UNGROUPED]
      const out = []
      const seen = new Set()
      const push = (row) => {
        if (seen.has(row.id)) return
        seen.add(row.id)
        out.push(row)
      }
      for (const section of sections) {
        const members = panels.filter((id) => sectionOf(config, id) === section)
        members.sort((a, b) => orderOf(a) - orderOf(b))
        if (section === UNGROUPED) {
          for (const id of members) push({ id, section, nested: false, folder: false })
          continue
        }
        push({ id: folderIdOf(section), section, nested: false, folder: true })
        if (collapsed.has(section)) continue
        for (const id of members) push({ id, section, nested: true, folder: false })
      }
      for (const id of panels) push({ id, section: sectionOf(config, id), nested: false, folder: false })
      return out
    }

    /** Sections with their rows, in sidebar order, for the dialog. */
    function buildModel(panels, config) {
      const rows = sequence(config, panels.map((panel) => panel.id)).filter((row) => !row.folder)
      const byId = new Map(panels.map((panel) => [panel.id, panel]))
      const hidden = new Set(config.hidden)
      const closed = new Set(config.collapsed)
      const groupById = new Map(config.groups.map((group) => [group.id, group]))
      const label = copy()
      const sections = []
      for (const sectionId of config.sections) {
        const sectionRows = []
        for (const row of rows) {
          if (row.section !== sectionId) continue
          const panel = byId.get(row.id)
          if (panel === undefined) continue
          sectionRows.push({ id: row.id, label: panel.label, hidden: hidden.has(row.id) })
        }
        const group = groupById.get(sectionId)
        sections.push({
          id: sectionId,
          name: group === undefined ? label.ungrouped : group.name,
          kind: group === undefined ? 'ungrouped' : 'group',
          collapsed: closed.has(sectionId),
          rows: sectionRows,
        })
      }
      return sections
    }

    // ---------------------------------------------------------------------
    // state
    // ---------------------------------------------------------------------

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(patch) {
          let changed = false
          for (const key of Object.keys(patch)) {
            if (state[key] !== patch[key]) {
              changed = true
              break
            }
          }
          if (!changed) return
          state = { ...state, ...patch }
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    const store = createStore({
      open: false,
      panels: [],
      config: defaultConfig(),
      /** Whether the boot-time pin setter was found; the dialog says so when not. */
      liveAtBoot: false,
      saving: false,
      error: null,
    })

    /** Set by the sidebar's own slot registration, then kept for the page's lifetime. */
    let setPinned
    /**
     * The order each panel declared the first time this page saw it. The live
     * `order` values are rewritten below, so they can no longer answer "where
     * would this plugin put its row by itself" — and that answer is the stable
     * fallback for a panel the saved layout has never seen.
     */
    const baseline = new Map()
    let applying = false
    let syncing = false
    let reconciling = false
    let saveTimer

    function useStore() {
      const [, bump] = React.useReducer((count) => count + 1, 0)
      React.useEffect(() => store.subscribe(bump), [])
      return store.get()
    }

    // ---------------------------------------------------------------------
    // sidebar wiring
    // ---------------------------------------------------------------------

    /** Resolve `label`, which the slot system allows as a string or a factory. */
    function labelOf(options) {
      const raw = options.label
      try {
        const value = typeof raw === 'function' ? raw() : raw
        if (typeof value === 'string' && value.trim() !== '') return value
      } catch {
        // A label factory may read a locale that is not installed yet.
      }
      return String(options.id ?? '')
    }

    /** Every registered panel row, in the sidebar's declared order. */
    function readPanels(ctx) {
      let entries = []
      try {
        entries = ctx.slots.entriesOfSlot('sidebar.panellist')
      } catch {
        return []
      }
      const rows = []
      for (const entry of entries) {
        const options = entry?.options ?? {}
        const id = options.id
        if (typeof id !== 'string' || id === '' || id === FIXED_PANEL) continue
        if (id.startsWith(FOLDER_PREFIX)) continue
        if (!baseline.has(id)) baseline.set(id, typeof options.order === 'number' ? options.order : 0)
        rows.push({ id, order: baseline.get(id), label: labelOf(options) })
      }
      return rows.sort((a, b) => a.order - b.order)
    }

    /**
     * Recover the sidebar's pin setter. The sidebar passes it to every
     * `sidebar.panellist.actions` registration, but the dialog must hide rows
     * before the More menu is ever opened, so the boot path reads the sidebar's
     * own slot registration instead. Both routes call the same function.
     */
    function resolvePinSetter(ctx) {
      try {
        for (const entry of ctx.slots.entriesOfSlot('sidebar')) {
          const inject = entry?.options?.inject ?? entry?.inject
          if (typeof inject !== 'function') continue
          let injected
          try {
            injected = inject({})
          } catch {
            try {
              injected = inject()
            } catch {
              continue
            }
          }
          if (injected !== null && typeof injected === 'object' && typeof injected.setPinned === 'function') {
            return injected.setPinned
          }
        }
      } catch {
        // A different sidebar build: the menu callback still works.
      }
      return undefined
    }

    /** Panels that must not draw a row: explicitly hidden, or inside a closed folder. */
    function hiddenPanels() {
      const config = normalizeConfig(store.get().config)
      const hidden = new Set(config.hidden)
      const closed = new Set(config.collapsed)
      for (const panel of store.get().panels) {
        const section = sectionOf(config, panel.id)
        if (section !== UNGROUPED && closed.has(section)) hidden.add(panel.id)
      }
      return hidden
    }

    /** Reconcile the sidebar's pin list with the saved layout. */
    function applyVisibility() {
      const hidden = hiddenPanels()
      const pin = typeof setPinned === 'function' ? setPinned : store.get().rowPins
      if (typeof pin !== 'function') return
      for (const panel of store.get().panels) {
        if (panel.id === FIXED_PANEL) continue
        try {
          pin(panel.id, !hidden.has(panel.id))
        } catch {
          // A panel id the sidebar no longer knows: nothing to hide.
        }
      }
    }

    /**
     * Push one registry sync so the sidebar re-reads the options we rewrote.
     * Registering and dropping a scratch row is the only way to make the
     * registry announce a change; both calls run in one task, so React never
     * paints the scratch row.
     */
    function forceSync(ctx) {
      if (syncing) return
      syncing = true
      try {
        const off = ctx.slots.register(
          { name: 'sidebar.panellist', id: `__sm_sync_${Math.random().toString(36).slice(2)}`, label: '', order: 0 },
          () => null,
        )
        off()
      } catch {
        // A slot build that rejects the probe: the next real change re-sorts anyway.
      } finally {
        syncing = false
      }
    }

    /**
     * Write the computed order onto the live registration options and ask for
     * one sync. The options are page state, not the plugin's own; every boot
     * replays this before the user sees the list.
     */
    function applyOrder(ctx) {
      if (ctx === undefined || applying) return
      applying = true
      let changed = false
      try {
        const config = normalizeConfig(store.get().config)
        const panels = readPanels(ctx).map((panel) => panel.id)
        const seq = sequence(config, panels)
        const entries = new Map()
        for (const entry of ctx.slots.entriesOfSlot('sidebar.panellist')) {
          const id = entry?.options?.id
          if (typeof id === 'string') entries.set(id, entry)
        }
        const fixed = entries.get(FIXED_PANEL)
        if (fixed !== undefined && fixed.options.order !== 0) {
          try {
            fixed.options.order = 0
            changed = true
          } catch {
            // frozen options: leave the built-in row where the shell put it
          }
        }
        seq.forEach((row, index) => {
          const id = row.id
          const entry = entries.get(id)
          if (entry === undefined) return
          const wanted = 10 + index * 10
          if (entry.options.order === wanted) return
          try {
            entry.options.order = wanted
            changed = true
          } catch {
            // frozen options: leave this row where the plugin declared it
          }
        })
      } finally {
        applying = false
      }
      if (changed) forceSync(ctx)
      scheduleAnnotate()
    }

    // ---------------------------------------------------------------------
    // group captions on the real sidebar rows
    // ---------------------------------------------------------------------

    let annotateFrame
    let navObserver
    let navResize
    let navWait = 0

    function scheduleAnnotate() {
      if (annotateFrame !== undefined) return
      const run = () => {
        annotateFrame = undefined
        annotate()
      }
      annotateFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 30)
    }

    /** The panel navigation landmark, recognized by its row buttons. */
    function navElement() {
      if (typeof document === 'undefined') return null
      for (const nav of document.querySelectorAll('nav')) {
        if (nav.querySelector(':scope > button[aria-label]') !== null) return nav
      }
      return null
    }

    /**
     * Mark the real rows so CSS can draw folders and nesting. Rows are matched by
     * position: the sidebar renders exactly the visible part of the same sequence
     * computed here, and the More launcher is not a direct child.
     */
    function annotate() {
      const nav = navElement()
      if (nav === null) {
        // The shell mounts after the client tree boots, so the landmark can be
        // missing for the first frames; keep looking instead of giving up.
        if (navWait < 40) {
          navWait += 1
          setTimeout(scheduleAnnotate, 250)
        }
        return
      }
      navWait = 0
      watchNav()
      const rows = [...nav.children].filter((element) => element.tagName === 'BUTTON' && element.hasAttribute('aria-label'))
      const config = normalizeConfig(store.get().config)
      const panels = store.get().panels.map((panel) => panel.id)
      const hidden = hiddenPanels()
      const visible = [
        { id: FIXED_PANEL, folder: false, nested: false, section: undefined },
        ...sequence(config, panels).filter((row) => !hidden.has(row.id)),
      ]
      rows.forEach((row, index) => {
        row.removeAttribute('data-sm-folder')
        row.removeAttribute('data-sm-nested')
        row.removeAttribute('data-sm-group')
        row.removeAttribute('aria-expanded')
        const entry = visible[index]
        if (entry === undefined) return
        if (entry.folder) {
          row.setAttribute('data-sm-folder', '1')
          row.setAttribute('data-sm-group', entry.section)
          row.setAttribute('aria-expanded', config.collapsed.includes(entry.section) ? 'false' : 'true')
        } else if (entry.nested) {
          row.setAttribute('data-sm-nested', '1')
        }
      })
    }

    /** Follow the nav's children and width so captions survive re-renders and the rail. */
    function watchNav() {
      if (typeof MutationObserver !== 'function') return
      const nav = navElement()
      if (nav === null) return
      if (navObserver !== undefined && navObserver.target === nav) return
      if (navObserver !== undefined) navObserver.disconnect()
      navObserver = new MutationObserver(() => scheduleAnnotate())
      navObserver.target = nav
      navObserver.observe(nav, { childList: true })
      if (typeof ResizeObserver === 'function' && navResize === undefined) {
        navResize = new ResizeObserver(() => scheduleAnnotate())
        navResize.observe(nav)
      }
    }

    // ---------------------------------------------------------------------
    // persistence
    // ---------------------------------------------------------------------

    function scheduleSave() {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = undefined
        void save()
      }, 250)
    }

    async function save() {
      const config = store.get().config
      store.set({ saving: true, error: null })
      try {
        const response = await fetch(route(CONFIG_ROUTE), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(config),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const saved = await response.json()
        store.set({ saving: false, config: normalizeConfig(saved) })
      } catch (error) {
        store.set({ saving: false, error: String(error?.message ?? error) })
      }
    }

    async function load() {
      try {
        const response = await fetch(route(CONFIG_ROUTE), { headers: { accept: 'application/json' } })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        store.set({ config: normalizeConfig(await response.json()) })
        if (runtime.ctx !== undefined) syncFolders(runtime.ctx)
        applyVisibility()
        if (runtime.ctx !== undefined) applyOrder(runtime.ctx)
      } catch (error) {
        store.set({ error: String(error?.message ?? error) })
      }
    }

    // ---------------------------------------------------------------------
    // mutations
    // ---------------------------------------------------------------------

    /** Apply a config edit, then rebuild rows, re-order, reconcile visibility and save. */
    function commit(mutate) {
      const next = normalizeConfig(store.get().config)
      mutate(next)
      store.set({ config: normalizeConfig(next) })
      if (runtime.ctx !== undefined) {
        syncFolders(runtime.ctx)
        applyOrder(runtime.ctx)
        // Folder row labels are resolved when the sidebar rebuilds its list, so
        // a rename needs one more registry sync even when no order changed.
        if (store.get().config.groups.length > 0) forceSync(runtime.ctx)
      }
      applyVisibility()
      scheduleAnnotate()
      scheduleSave()
    }

    /** Hide or show one row immediately. */
    function setVisible(id, visible) {
      if (id === FIXED_PANEL) return
      commit((config) => {
        config.hidden = visible ? config.hidden.filter((entry) => entry !== id) : [...config.hidden, id]
      })
    }

    /** Show every registered row again and open every folder. */
    function showAll() {
      commit((config) => {
        config.hidden = []
      })
    }

    /** Open or close one folder row. */
    function toggleCollapsed(id) {
      commit((config) => {
        config.collapsed = config.collapsed.includes(id)
          ? config.collapsed.filter((entry) => entry !== id)
          : [...config.collapsed, id]
      })
    }

    /** Live folder rows this plugin registered, by group id. */
    const folderRows = new Map()

    /** Current name of a group, as the folder row's label. */
    function folderName(groupId) {
      const group = store.get().config.groups.find((candidate) => candidate.id === groupId)
      return group === undefined || group.name.trim() === '' ? copy().defaultGroup : group.name
    }

    /** Register, relabel and drop folder rows so the sidebar has one per group. */
    function syncFolders(ctx) {
      if (ctx === undefined || reconciling) return
      reconciling = true
      try {
        const wanted = new Set(store.get().config.groups.map((group) => group.id))
        for (const [groupId, off] of [...folderRows]) {
          if (wanted.has(groupId)) continue
          folderRows.delete(groupId)
          try {
            off()
          } catch {
            // already gone
          }
        }
        for (const groupId of wanted) {
          if (folderRows.has(groupId)) continue
          try {
            const off = ctx.slots.register(
              { name: 'sidebar.panellist', id: folderIdOf(groupId), label: () => folderName(groupId), order: 0 },
              () => h(FolderGlyph, { groupId }),
            )
            folderRows.set(groupId, off)
          } catch (error) {
            console.error('[sidebar-manager] group row failed', error)
          }
        }
      } finally {
        reconciling = false
      }
    }

    /** One chevron for folder rows and dialog section headers. */
    function Chevron({ open, size = 10 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 10 10', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M3.4 1.6 7 5l-3.6 3.4',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /**
     * The glyph of a folder row. The row button belongs to the sidebar and would
     * select a panel; a full-row transparent layer stops that click and toggles
     * the folder instead, which is the behavior a file tree has.
     */
    function FolderGlyph({ groupId }) {
      const state = useStore()
      const open = !state.config.collapsed.includes(groupId)
      const toggle = (event) => {
        event.preventDefault()
        event.stopPropagation()
        toggleCollapsed(groupId)
      }
      return h(
        React.Fragment,
        null,
        h('span', { className: 'sm-folder-hit', 'aria-hidden': 'true', onClick: toggle }),
        h(
          'span',
          { className: 'sm-chevron', 'data-open': open ? 'true' : 'false', 'aria-hidden': 'true' },
          h(Chevron, { open }),
        ),
      )
    }

    /** Place `id` in `section` and move it to the section's end. */
    function place(next, id, section) {
      if (section === UNGROUPED) delete next.placement[id]
      else next.placement[id] = section
      const flat = buildModel(store.get().panels, next).flatMap((block) =>
        block.rows.map((row) => ({ id: row.id, section: block.id })),
      )
      const others = flat.filter((row) => row.id !== id)
      const ids = others.map((row) => row.id)
      let insertAt = ids.length
      for (let index = others.length - 1; index >= 0; index -= 1) {
        if (others[index].section === section) {
          insertAt = index + 1
          break
        }
      }
      ids.splice(insertAt, 0, id)
      next.order = ids
    }

    /** Move a row to another section from the row's picker. */
    function moveToGroup(id, section) {
      if (id === FIXED_PANEL) return
      commit((next) => place(next, id, section))
    }

    /** Move one row by one position, crossing into the neighbour's section when it must. */
    function moveRow(id, delta) {
      const config = normalizeConfig(store.get().config)
      const flat = buildModel(store.get().panels, config).flatMap((block) =>
        block.rows.map((row) => ({ id: row.id, section: block.id })),
      )
      const from = flat.findIndex((row) => row.id === id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= flat.length) return
      const target = flat[to]
      const ids = flat.map((row) => row.id)
      ids.splice(from, 1)
      ids.splice(to, 0, id)
      commit((next) => {
        next.order = ids
        if (target.section !== flat[from].section) {
          if (target.section === UNGROUPED) delete next.placement[id]
          else next.placement[id] = target.section
        }
      })
    }

    function moveSection(id, delta) {
      commit((next) => {
        const at = next.sections.indexOf(id)
        const to = at + delta
        if (at < 0 || to < 0 || to >= next.sections.length) return
        next.sections.splice(at, 1)
        next.sections.splice(to, 0, id)
      })
    }

    function renameGroup(id, name) {
      commit((next) => {
        const group = next.groups.find((candidate) => candidate.id === id)
        if (group !== undefined) group.name = name.slice(0, GROUP_NAME_LIMIT)
      })
    }

    function deleteGroup(id) {
      commit((next) => {
        next.groups = next.groups.filter((group) => group.id !== id)
        next.sections = next.sections.filter((section) => section !== id)
        for (const [panel, groupId] of Object.entries(next.placement)) {
          if (groupId === id) delete next.placement[panel]
        }
      })
    }

    function addGroup() {
      const id = `g-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      commit((next) => {
        next.groups.push({ id, name: copy().newGroup })
        const at = next.sections.indexOf(UNGROUPED)
        next.sections.splice(at < 0 ? next.sections.length : at, 0, id)
      })
    }

    // ---------------------------------------------------------------------
    // UI
    // ---------------------------------------------------------------------

    function openManager() {
      const ctx = runtime.ctx
      store.set({ open: true, panels: ctx !== undefined ? readPanels(ctx) : store.get().panels, error: null })
      scheduleAnnotate()
    }

    function closeManager() {
      if (saveTimer !== undefined) {
        clearTimeout(saveTimer)
        saveTimer = undefined
        void save()
      }
      store.set({ open: false })
    }

    function IconButton({ label, onClick, disabled, children }) {
      return h('button', { type: 'button', className: 'sm-icon', 'aria-label': label, title: label, onClick, disabled }, children)
    }

    function SectionHeader({ block, index, total, t }) {
      return h(
        'div',
        { className: 'sm-sec' },
        block.kind === 'group'
          ? h(
              'button',
              {
                type: 'button',
                className: 'sm-icon sm-sec-toggle',
                'data-open': block.collapsed ? 'false' : 'true',
                'aria-label': block.collapsed ? t.expandGroup : t.collapseGroup,
                title: block.collapsed ? t.expandGroup : t.collapseGroup,
                onClick: () => toggleCollapsed(block.id),
              },
              h(Chevron, { open: !block.collapsed, size: 12 }),
            )
          : null,
        block.kind === 'group'
          ? h('input', {
              className: 'sm-sec-input',
              value: block.name,
              'aria-label': t.groupName,
              placeholder: t.groupName,
              maxLength: GROUP_NAME_LIMIT,
              onFocus: (event) => event.target.select(),
              onChange: (event) => renameGroup(block.id, event.target.value),
            })
          : h('span', { className: 'sm-sec-name' }, t.ungrouped),
        h(IconButton, { label: t.moveSectionUp, disabled: index === 0, onClick: () => moveSection(block.id, -1) }, '↑'),
        h(IconButton, { label: t.moveSectionDown, disabled: index === total - 1, onClick: () => moveSection(block.id, 1) }, '↓'),
        block.kind === 'group'
          ? h(IconButton, { label: t.deleteGroup, onClick: () => deleteGroup(block.id) }, '×')
          : null,
      )
    }

    function PanelRow({ row, sections, first, last, t }) {
      return h(
        'div',
        { className: 'sm-row', 'data-sm-panel': row.id, 'data-sm-visible': row.hidden ? 'false' : 'true' },
        h('span', { className: 'sm-label', title: row.label }, row.label),
        h(
          'select',
          {
            className: 'sm-select',
            'aria-label': t.groupTo,
            title: t.groupTo,
            value: sections.find((section) => section.rows.some((candidate) => candidate.id === row.id))?.id ?? UNGROUPED,
            onChange: (event) => moveToGroup(row.id, event.target.value),
          },
          sections.map((section) => h('option', { key: section.id, value: section.id }, section.name)),
        ),
        h(IconButton, { label: t.moveUp, disabled: first, onClick: () => moveRow(row.id, -1) }, '↑'),
        h(IconButton, { label: t.moveDown, disabled: last, onClick: () => moveRow(row.id, 1) }, '↓'),
        h(
          'button',
          {
            type: 'button',
            role: 'switch',
            className: 'sm-switch',
            'aria-checked': row.hidden ? 'false' : 'true',
            'aria-label': row.hidden ? t.showRow : t.hideRow,
            title: row.hidden ? t.showRow : t.hideRow,
            onClick: () => setVisible(row.id, row.hidden),
          },
          h('span', { className: 'sm-knob' }),
        ),
      )
    }

    function ManagerDialog({ state }) {
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          closeManager()
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [])

      const t = copy()
      const sections = buildModel(state.panels, state.config)
      const total = sections.reduce((sum, block) => sum + block.rows.length, 0)
      const shown = sections.reduce((sum, block) => sum + block.rows.filter((row) => !row.hidden).length, 0)
      const hint = state.error
        ? t.savedError(state.error)
        : state.saving
          ? t.saving
          : state.liveAtBoot
            ? t.hint
            : t.hintStale

      return h(
        'div',
        {
          className: 'sm-overlay',
          'data-sidebar-manager': 'overlay',
          onPointerDown: (event) => {
            if (event.target === event.currentTarget) closeManager()
          },
        },
        h(
          'div',
          { className: 'sm-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': t.title },
          h(
            'header',
            { className: 'sm-head' },
            h(
              'div',
              null,
              h('div', { className: 'sm-title' }, t.title),
              h('div', { className: 'sm-sub' }, t.sub(shown, total)),
            ),
            h('button', { type: 'button', className: 'sm-close', 'aria-label': t.close, onClick: closeManager }, '×'),
          ),
          h(
            'div',
            { className: 'sm-list' },
            total === 0
              ? h('div', { className: 'sm-empty' }, t.empty)
              : sections.map((block, index) => {
                  const rows = block.rows
                  return h(
                    React.Fragment,
                    { key: block.id },
                    h(SectionHeader, { block, index, total: sections.length, t }),
                    rows.map((row, rowIndex) =>
                      h(PanelRow, {
                        key: row.id,
                        row,
                        sections,
                        first: rowIndex === 0 && index === 0,
                        last: rowIndex === rows.length - 1 && index === sections.length - 1,
                        t,
                      }),
                    ),
                  )
                }),
            total === 0
              ? null
              : h('button', { type: 'button', className: 'sm-add', onClick: addGroup }, `＋ ${t.newGroup}`),
          ),
          h(
            'footer',
            { className: 'sm-foot' },
            h('button', { type: 'button', className: 'sm-btn', onClick: showAll, disabled: state.config.hidden.length === 0 }, t.showAll),
            h('span', { className: 'sm-status' }, hint),
            h('button', { type: 'button', className: 'sm-btn sm-primary', onClick: closeManager }, t.done),
          ),
        ),
      )
    }

    /** Always-mounted seat that owns the portal, so closing the More menu keeps the dialog. */
    function ManagerMount() {
      const state = useStore()
      if (!state.open) return null
      return createPortal(h(ManagerDialog, { state }), document.body)
    }

    /** One row in the More menu. Its props also carry the sidebar's pin callback. */
    function MenuRow({ onDismiss, onPinnedChange }) {
      React.useEffect(() => {
        if (typeof onPinnedChange !== 'function') return
        store.set({ rowPins: onPinnedChange })
        if (typeof setPinned !== 'function') {
          setPinned = onPinnedChange
          applyVisibility()
        }
      }, [onPinnedChange])

      return h(
        MenuItem,
        {
          icon: SlidersIcon !== undefined ? h(SlidersIcon, { size: 16 }) : undefined,
          onSelect: () => {
            openManager()
            if (typeof onDismiss === 'function') onDismiss()
          },
        },
        copy().row,
      )
    }

    // ---------------------------------------------------------------------
    // plugin
    // ---------------------------------------------------------------------

    const runtime = { ctx: undefined }

    function register(ctx, slot, options, component) {
      try {
        ctx.slots.inject(slot, () => ctx.slots.register(options, component))
      } catch {
        // An option a different slot build rejects: retry with the minimum.
        const minimal = { name: slot, id: options.id }
        try {
          ctx.slots.inject(slot, () => ctx.slots.register(minimal, component))
        } catch (error) {
          console.error('[sidebar-manager] registration failed for', slot, error)
        }
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        runtime.ctx = ctx
        installStyles()

        /**
         * Find the pin setter as soon as the sidebar publishes it. The sidebar's
         * slot entry may register after this plugin, so every later slot event
         * retries; frame-delayed retries cover a sidebar that mounts without
         * changing the panel list.
         */
        const ensurePins = () => {
          if (typeof setPinned === 'function') return true
          const found = resolvePinSetter(ctx)
          if (found === undefined) return false
          setPinned = found
          store.set({ liveAtBoot: true })
          applyVisibility()
          return true
        }

        if (!ensurePins()) {
          let attempts = 0
          const retry = () => {
            if (ensurePins() || ++attempts >= 30) return
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(retry)
            else setTimeout(retry, 50)
          }
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(retry)
          else setTimeout(retry, 50)
        }

        ctx.effect(
          () =>
            ctx.slots.subscribe('sidebar.panellist', () => {
              if (syncing) return
              store.set({ panels: readPanels(ctx) })
              ensurePins()
              applyVisibility()
              applyOrder(ctx)
              watchNav()
            }),
          'sidebar-manager: panel entries',
        )

        ctx.effect(
          () =>
            ctx.slots.subscribe('sidebar', () => {
              ensurePins()
              applyOrder(ctx)
              watchNav()
            }),
          'sidebar-manager: sidebar entry',
        )

        register(ctx, 'sidebar.footer.action', { name: 'sidebar.footer.action', id: 'sidebar-manager-mount' }, ManagerMount)
        register(ctx, 'sidebar.panellist.actions', { name: 'sidebar.panellist.actions', id: 'sidebar-manager', order: -10 }, MenuRow)

        const onFolderKey = (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          const target = event.target
          if (!(target instanceof Element)) return
          const button = target.closest('nav > button[data-sm-folder]')
          if (button === null) return
          const groupId = button.getAttribute('data-sm-group')
          if (groupId === null) return
          event.preventDefault()
          event.stopPropagation()
          toggleCollapsed(groupId)
        }
        document.addEventListener('keydown', onFolderKey, true)
        ctx.effect(() => () => document.removeEventListener('keydown', onFolderKey, true), 'sidebar-manager: folder keys')

        store.set({ panels: readPanels(ctx) })
        syncFolders(ctx)
        applyOrder(ctx)
        applyVisibility()
        watchNav()
        scheduleAnnotate()
        void load()
      },
    }
  },
})
