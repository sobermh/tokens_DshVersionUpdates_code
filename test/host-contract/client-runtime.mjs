/**
 * The browser half of the contract fixture.
 *
 * The plugin ships `dist/client.js` as a `window.__ModuleLoader__` bundle with
 * every `@deepseek-ai/*` import left external: the host resolves those names at
 * render time, so a renamed export fails inside React and only once an update
 * is actually available. These cases therefore materialise the real bundle
 * against the staged host's own client runtime:
 *
 *  - `@deepseek-ai/dsh-client-ui-renderer/client` — the real `SlotRegistry`,
 *    installed as `ctx.slots` on a real `@deepseek-ai/cordis` Context.
 *  - `@deepseek-ai/dsh-client-ui-slots` — the real slot core underneath it.
 *  - `@deepseek-ai/dsh-client-connection/client` — the real browser Connection,
 *    whose transport is pointed at a live host over authenticated HTTP.
 *  - `jsdom`, `react` and `react/jsx-runtime` — the staged host's own copies.
 *
 * One boundary, documented in `docs/host-interfaces.md`: the product bundles
 * the renderer layer into `dsh-web-frontend/dist`, and the npm copy of
 * `@deepseek-ai/dsh-client-ui-primitives` in a staged tree is ESM source that
 * imports `.module.css`, so it cannot be materialised in Node. The two names
 * the plugin imports from it are supplied here, and HOST-022 checks against the
 * staged host that those names still exist.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

import { hostRoot, pluginRoot } from './live-host.mjs'

/** Names the plugin's client entry imports from the host's primitives package. */
export const PRIMITIVE_NAMES = ['IconDownloadOutlineRegular', 'Tooltip']

/** The sidebar slot this plugin registers into. */
export const SIDEBAR_SLOT = 'sidebar.footer.action'

/**
 * Read the slot spec the staged host's own sidebar bundle declares, so the
 * fixture declares it with the host's `kind`/`scope` rather than a guess.
 * @returns `{ kind, scope }`, or undefined when this host declares no such slot.
 */
export function sidebarSlotSpec() {
  const hostRequire = createRequire(path.join(hostRoot(), 'package.json'))
  const source = readFileSync(hostRequire.resolve('@deepseek-ai/dsh-client-ui-sidebar/client'), 'utf8')
  const declaration = new RegExp(
    `"${SIDEBAR_SLOT.replaceAll('.', '\\.')}":\\s*\\{\\s*kind:\\s*"(\\w+)",\\s*scope:\\s*"(\\w+)"`,
    'u',
  ).exec(source)
  return declaration === null ? undefined : { kind: declaration[1], scope: declaration[2] }
}

/** Export names the staged host's copy of one package still publishes. */
export function hostExportNames(specifier) {
  const hostRequire = createRequire(path.join(hostRoot(), 'package.json'))
  const names = new Set()
  const pending = [hostRequire.resolve(specifier)]
  const seen = new Set()
  while (pending.length > 0) {
    const file = pending.shift()
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/export\s*\{([^}]*)\}/gu)) {
      for (const part of match[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/u).pop()
        if (name && name !== 'default') names.add(name)
      }
    }
    for (const match of source.matchAll(/export\s*\*\s*from\s*["'](\.[^"']+)["']/gu)) {
      pending.push(path.resolve(path.dirname(file), match[1]))
    }
  }
  return names
}

/**
 * Build a browser realm holding the staged host's real client runtime and this
 * plugin's real client bundle.
 *
 * @param options.origin - live host origin for the Connection transport.
 * @param options.cookie - the Cookie the live host minted for a browser page.
 * @returns the assembled context plus the handles the cases assert on.
 */
export async function startClientRuntime(options = {}) {
  const hostRequire = createRequire(path.join(hostRoot(), 'package.json'))
  const { JSDOM } = hostRequire('jsdom')
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', {
    url: options.origin ?? 'http://127.0.0.1/',
  })

  const savedGlobals = []
  const setGlobal = (name, value) => {
    savedGlobals.push([name, Object.getOwnPropertyDescriptor(globalThis, name)])
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
  setGlobal('window', dom.window)
  setGlobal('document', dom.window.document)
  setGlobal('navigator', dom.window.navigator)
  setGlobal('HTMLElement', dom.window.HTMLElement)

  // The kernel's registration target: executing a bundle only registers its
  // factory, and `require` materialises on first use. That is the host's own
  // lazy-CJS protocol, not a convenience of this fixture.
  const registered = new Map()
  dom.window.__ModuleLoader__ = {
    load(registration) { registered.set(registration.id, registration.factory) },
  }

  const materialised = new Map()
  const plain = new Map()
  const requireModule = (specifier) => {
    if (registered.has(specifier)) {
      if (!materialised.has(specifier)) {
        materialised.set(specifier, registered.get(specifier)(requireModule))
      }
      return materialised.get(specifier)
    }
    if (plain.has(specifier)) return plain.get(specifier)
    const value = hostRequire(specifier)
    plain.set(specifier, value)
    return value
  }

  const esm = async (specifier) =>
    await import(pathToFileURL(hostRequire.resolve(specifier)).href)
  plain.set('@deepseek-ai/cordis', await esm('@deepseek-ai/cordis'))
  plain.set('@deepseek-ai/dsh-client-ui-slots', await esm('@deepseek-ai/dsh-client-ui-slots'))
  // The documented boundary; HOST-022 holds the host to these two names.
  plain.set('@deepseek-ai/dsh-client-ui-primitives', {
    IconDownloadOutlineRegular: () => null,
    Tooltip: ({ children }) => children,
  })

  const execute = (file) => { vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file }) }
  execute(hostRequire.resolve('@deepseek-ai/dsh-client-ui-renderer/client'))
  execute(path.join(pluginRoot, 'dist', 'client.js'))

  /**
   * Load one client entry whichever way this host generation ships it: DSH
   * 0.2.1 added a Node ESM variant, older lines ship only the browser bundle.
   */
  const clientEntry = async (specifier, id) => {
    const file = hostRequire.resolve(`${specifier}/client`)
    if (!readFileSync(file, 'utf8').startsWith('window.__ModuleLoader__')) return await esm(`${specifier}/client`)
    execute(file)
    return requireModule(id)
  }

  const cordis = plain.get('@deepseek-ai/cordis')
  const ctx = new cordis.Context()
  requireModule('@deepseek-ai/dsh-client-ui-renderer').apply(ctx)

  // The real browser Connection, carrying the real page cookie to a live host.
  const connectionClient = await clientEntry(
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-connection',
  )
  let connectionInstalled = false
  if (options.origin !== undefined && options.cookie !== undefined
    && typeof connectionClient.installConnection === 'function') {
    connectionClient.installConnection(ctx, {
      interactions: 'none',
      transport: {
        fetch: (input, init) => fetch(new URL(String(input), `${options.origin}/`), {
          ...init,
          headers: { ...(init?.headers ?? {}), cookie: options.cookie },
        }),
      },
    })
    connectionInstalled = true
  }

  const spec = sidebarSlotSpec()
  const releaseDeclaration = spec === undefined
    ? undefined
    : ctx.slots.registerFactory(
      { name: 'fixture.sidebar.host-contract', children: { [SIDEBAR_SLOT]: spec } },
      () => null,
    )

  return {
    ctx,
    dom,
    spec,
    connectionInstalled,
    /** Whether this host generation exposes a composable client Connection. */
    composableConnection: typeof connectionClient.installConnection === 'function',
    pluginClient: () => requireModule('@tokens/dsh-version-updates'),
    registeredBundles: () => [...registered.keys()],
    seats: () => ctx.slots.entries(SIDEBAR_SLOT) ?? [],
    dispose() {
      releaseDeclaration?.()
      dom.window.close()
      for (const [name, descriptor] of savedGlobals.reverse()) {
        if (descriptor === undefined) delete globalThis[name]
        else Object.defineProperty(globalThis, name, descriptor)
      }
    },
  }
}
