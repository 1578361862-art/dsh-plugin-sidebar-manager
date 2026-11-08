/**
 * Sidebar Manager — Host half.
 *
 * Persists which left-sidebar panels the user chose to hide, in the profile's
 * own storage (`$DSH_HOME/storages/sidebar-manager/config.json`), and serves it
 * to the browser half over same-origin HTTP.
 *
 * Why an HTTP route instead of a Typert remote: a third-party plugin cannot ship
 * the generated invocation descriptors strict mode wants, and the document
 * generation path is documented as a development path. Named `ctx.webServer`
 * routes need no codegen and no gateway wiring, which keeps this plugin
 * dependency-free. The route is unauthenticated like the rest of the loopback
 * UI, so the write path additionally requires a loopback peer.
 *
 * The host half stores nothing else: the plugin has no tools, no session events,
 * and no model-facing surface.
 *
 * @module @local/dsh-sidebar-manager
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Cordis service this plugin requires; the host half is meaningless without it. */
export const inject = ['webServer']

/** Plugin name as it appears in the loader tree. */
export const name = 'sidebar-manager'

/** Route prefix owned by this plugin. */
const ROUTE_PREFIX = '/sidebar-manager'

/** Directory under `$DSH_HOME/storages` holding the one file this plugin owns. */
const DATA_DIR = 'sidebar-manager'

/** A settings body larger than this is a mistake, not a configuration. */
const MAX_BODY_BYTES = 32 * 1024

/**
 * Panels no plugin may hide: the Plugins row is the way back into the plugin
 * list, and the sidebar refuses to unpin it, so the stored config mirrors that.
 */
const FIXED_PANELS = new Set(['plugins'])

/** `$DSH_HOME`, matching the rest of the harness, with a portable fallback. */
function homeDir() {
  const fromEnv = process.env.DSH_HOME
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
}

/** @returns the absolute path of this plugin's config file. */
function configPath() {
  return join(homeDir(), 'storages', DATA_DIR, 'config.json')
}

/** Section id standing for "not in any group"; always present, never a group. */
const UNGROUPED = '__ungrouped__'

/** Longest accepted group name. */
const GROUP_NAME_LIMIT = 40

/** Keep only meaningful, unique, non-fixed panel ids. */
function cleanIds(value) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(value) ? value : []) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (id === '' || FIXED_PANELS.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Repair anything a hand edit, an older build, or a deleted group left behind:
 * unknown placements drop, sections are rebuilt from the groups that exist, and
 * the ungrouped bucket always exists exactly once. Version 1 files (a bare
 * `hidden` list) normalize into an empty layout.
 * @param value - decoded JSON from disk or a request body.
 * @returns the normalized config.
 */
export function normalizeConfig(value) {
  const source = value !== null && typeof value === 'object' ? value : {}

  const groups = []
  for (const raw of Array.isArray(source.groups) ? source.groups : []) {
    if (raw === null || typeof raw !== 'object') continue
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (id === '' || id === UNGROUPED || groups.some((group) => group.id === id)) continue
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, GROUP_NAME_LIMIT) : ''
    groups.push({ id, name: name === '' ? 'Group' : name })
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

/**
 * Read the stored config. A missing, unreadable, or corrupt file is an empty
 * config: the sidebar then shows every row, which is the default composition.
 * @param path - config path, overridable for tests.
 * @returns the normalized config.
 */
export function readConfig(path = configPath()) {
  try {
    return normalizeConfig(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return normalizeConfig(undefined)
  }
}

/**
 * Replace the stored config atomically.
 * @param value - the desired config.
 * @param path - config path, overridable for tests.
 * @returns the normalized config actually written.
 */
export function writeConfig(value, path = configPath()) {
  const next = normalizeConfig(value)
  mkdirSync(dirname(path), { recursive: true })
  const text = `${JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2)}\n`
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, text)
  try {
    renameSync(temp, path)
  } catch {
    // Windows cannot rename over an existing file; the complete temp file is
    // already on disk, so removing the old one first loses nothing.
    try {
      unlinkSync(path)
    } catch {
      // absent is fine
    }
    renameSync(temp, path)
  }
  return next
}

/** @param req - incoming request. @returns the socket peer address. */
function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Write a JSON response. @param res - response. @param status - status code. @param payload - body. */
function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Read a bounded request body. @param req - request. @returns the text. */
function readBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        const error = new Error(`request body larger than ${MAX_BODY_BYTES} bytes`)
        error.statusCode = 413
        rejectPromise(error)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', rejectPromise)
  })
}

/** Parse a JSON body, reporting a client-side mistake as a 400. @param req - request. @returns the parsed body. */
async function readJsonBody(req) {
  const text = (await readBody(req)) || '{}'
  try {
    return JSON.parse(text)
  } catch (error) {
    const bad = new Error(`the request body is not JSON: ${error?.message ?? error}`)
    bad.statusCode = 400
    throw bad
  }
}

/**
 * Host plugin body: one prefix route over the plugin's own config file.
 * @param ctx - host context carrying `webServer`.
 */
export function apply(ctx) {
  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'

    try {
      if (route === '/config' && (req.method === 'GET' || req.method === 'HEAD')) {
        sendJson(res, 200, { ok: true, ...readConfig(), path: configPath() })
        return
      }

      if (route === '/config' && (req.method === 'PUT' || req.method === 'POST')) {
        if (!isLoopback(req)) {
          sendJson(res, 403, { error: 'config writes are accepted from loopback clients only' })
          return
        }
        const patch = await readJsonBody(req)
        const saved = writeConfig(patch)
        sendJson(res, 200, { ok: true, ...saved })
        return
      }

      sendJson(res, 404, { error: `no such sidebar-manager route: ${route}` })
    } catch (error) {
      const status = Number(error?.statusCode) >= 400 && Number(error?.statusCode) < 500 ? Number(error.statusCode) : 500
      sendJson(res, status, { error: String(error?.message ?? error) })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: handle }),
    'sidebar-manager: config route',
  )
}
