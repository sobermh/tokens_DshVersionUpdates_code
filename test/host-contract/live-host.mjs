/**
 * Support layer for the real-host contract cases (HOST-001 … HOST-021).
 *
 * Everything here runs against ONE staged host: the `dsh-plugin-desktop`
 * directory of a product build (`.build/desktop`, `.build/desktop-v060`,
 * `.build/desktop-v0525`). `scripts/check-host-contracts.mjs` maps the gate's
 * single `DSH_HOST_ROOT` onto `TOKENS_HOST_ROOT` for this module.
 *
 * The host is never stubbed. `startLiveHost()` asks the host's own launcher
 * (`@deepseek-ai/dsh-app-boot`) to boot a throwaway profile whose loader
 * entries are the real services this plugin talks to — the Desktop WebServer
 * subclass compiled from the staged host's own `src/`, the real local
 * credential provider, and the real Connection host half — and lets the real
 * Loader activate the plugin from this work tree. `desktopRuntime` is the
 * object the real `host-runtime-bridge.ts` projects across a real `HostRpc`
 * pair, which is exactly what a packaged Host receives.
 *
 * Scripted, because none of it is a host interface: the Electron main process
 * on the far side of that bridge (the fixture plays the native adapter), the
 * GitHub release and asset endpoints, and the browser's cookie jar.
 *
 * Fixture safety: every host service that writes is pinned inside a throwaway
 * `$DSH_HOME`, and `assertInsideHome()` aborts the boot if any of them resolved
 * a document outside it. A fixture that writes the developer's own `~/.dsh`
 * has happened before (T0047, the web-search `filename`/`path` key), so this
 * check is fatal rather than advisory.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { createRequire, register } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The single variable this module reads; the gate only knows `DSH_HOST_ROOT`. */
export const HOST_ROOT_ENV = 'TOKENS_HOST_ROOT'

/**
 * Reasons a case may give for not executing and still pass the gate: this
 * host generation has no such interface, or this platform publishes no such
 * artifact. Every other reason — above all "there is no host" — fails closed,
 * so a case can never stop running quietly.
 */
export const ALLOWED_SKIP_PREFIXES = ['host-generation:', 'platform:']

/** The real fetch, captured before a case can replace the global one. */
const realFetch = globalThis.fetch

/** This repository, which always owns the tooling (esbuild, jsdom lookups). */
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

/**
 * The plugin files under test. Normally this repository;
 * `scripts/verify-host-contract-mutations.mjs` points it at a mutated copy so
 * a mutation never touches the work tree.
 */
export const pluginRoot = process.env.TOKENS_PLUGIN_ROOT
  ? path.resolve(process.env.TOKENS_PLUGIN_ROOT)
  : repoRoot

/** The loader entry id the product's own `cordis.patch.yml` gives this plugin. */
export const ENTRY_ID = 'tokens-version-updates'

/** The RPC channel the plugin's two halves share. */
export const RPC_CHANNEL = '/tokens-version-updates'

/** The entry config the product ships, so the cases exercise the real values. */
export const PRODUCT_CONFIG = Object.freeze({
  productName: 'TokensCowork',
  githubOwner: 'TokensAPI',
  githubRepo: 'TokensCowork',
  releaseIndexURL: 'https://tokensapi.github.io/TokensCowork/releases.json',
  releaseAPIURL: 'https://api.github.com/repos/TokensAPI/TokensCowork/releases/latest',
})

export function hostRoot() {
  const value = process.env[HOST_ROOT_ENV]
  return value ? path.resolve(value) : undefined
}

/** Why the host cases cannot run, or false when they can. */
export function missingHost() {
  const root = hostRoot()
  if (!root) return `${HOST_ROOT_ENV} is not set (the gate passes DSH_HOST_ROOT)`
  try {
    createRequire(path.join(root, 'package.json')).resolve('@deepseek-ai/dsh-app-boot')
  } catch {
    return `staged host has no @deepseek-ai/dsh-app-boot: ${root}`
  }
  return false
}

let hooked = false
/** Point bare `@deepseek-ai/*` specifiers at this staged host, once per process. */
function installResolveHook() {
  if (hooked) return
  register(new URL('./host-modules.mjs', import.meta.url).href, { data: { hostRoot: hostRoot() } })
  hooked = true
}

/** Import one package from the staged host, by the name the plugin would use. */
export async function loadHostModule(specifier) {
  installResolveHook()
  const resolved = createRequire(path.join(hostRoot(), 'package.json')).resolve(specifier)
  return { resolved, module: await import(pathToFileURL(resolved).href) }
}

/** Import one package from the staged host, or undefined when it ships no such package. */
export async function loadOptionalHostModule(specifier) {
  try {
    return await loadHostModule(specifier)
  } catch {
    return undefined
  }
}

/** Read one JSON manifest out of the staged host. */
export function hostManifest(specifier) {
  return createRequire(path.join(hostRoot(), 'package.json'))(`${specifier}/package.json`)
}

let compiled
/**
 * Compile the host-side TypeScript this plugin actually meets — the native
 * bridge and the Desktop WebServer subclass — out of the staged host's own
 * `src/`. Every `@deepseek-ai/*` stays external so the compiled code shares
 * the one runtime copy in the staged host's `node_modules`; a second physical
 * copy would break Cordis' module-local service symbols.
 */
export async function hostBridge() {
  if (compiled !== undefined) return compiled
  installResolveHook()
  const esbuild = await import(pathToFileURL(
    createRequire(path.join(repoRoot, 'package.json')).resolve('esbuild'),
  ).href)
  const built = await esbuild.build({
    stdin: {
      contents: [
        "export { createHostRuntime, bindNativeRuntime, runtimeSnapshot } from './host-runtime-bridge.ts'",
        "export { HostRpc } from './host-rpc.ts'",
        "export { DesktopWebServer } from './webserver.ts'",
      ].join('\n'),
      resolveDir: path.join(hostRoot(), 'src'),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    external: ['@deepseek-ai/*', 'electron'],
  })
  compiled = await import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
  )
  return compiled
}

let facts
/**
 * What this host generation actually provides, probed rather than inferred
 * from a version string. Cases that behave differently branch on a flag here
 * and say so in their report.
 */
export async function hostFacts() {
  if (facts !== undefined) return facts
  const appBoot = await loadHostModule('@deepseek-ai/dsh-app-boot')
  facts = {
    root: hostRoot(),
    runtimeVersion: hostManifest('@deepseek-ai/dsh').version,
    desktopVersion: createRequire(path.join(hostRoot(), 'package.json'))('./package.json').version,
    hasReadProfilePatches: typeof appBoot.module.readProfilePatches === 'function',
    hasCompatibilityEvaluator: typeof appBoot.module.evaluatePluginCompatibility === 'function',
    /**
     * Whether this host ships the pre-0.2 browser runtime. The slot core
     * gained Factory registration in DSH 0.2, which is also where the
     * primitives package renamed the icon exports this plugin's client half
     * imports, so the whole browser half belongs to one generation. Read from
     * the host's own shipped slot core, because the class defines the method
     * as an instance field and there is nothing on its prototype to probe.
     */
    legacyClientRuntime: !readFileSync(
      createRequire(path.join(hostRoot(), 'package.json'))
        .resolve('@deepseek-ai/dsh-client-ui-slots'),
      'utf8',
    ).includes('registerFactory'),
    /** The declared peer range this plugin supports; 0.1 hosts are deliberately outside it. */
    supportsPlugin: await pluginSupportsRuntime(),
  }
  return facts
}

/**
 * Ask the host's own compatibility evaluator whether this plugin's declared
 * requirements are met by this runtime, so "unsupported generation" is the
 * host's verdict and not a version string this fixture pattern-matches.
 */
async function pluginSupportsRuntime() {
  const appBoot = await loadHostModule('@deepseek-ai/dsh-app-boot')
  const evaluate = appBoot.module.evaluatePluginCompatibility
  const runtimeVersion = hostManifest('@deepseek-ai/dsh').version
  if (typeof evaluate !== 'function') {
    // DSH 0.1's app-boot has no evaluator; borrow none, and report the fact.
    return undefined
  }
  return evaluate(pluginManifest(), {}, runtimeVersion) === undefined
}

let manifestCache
/** This plugin's own manifest, read from the work tree. */
export function pluginManifest() {
  manifestCache ??= createRequire(path.join(pluginRoot, 'package.json'))('./package.json')
  return manifestCache
}

/** Import the plugin's host half, by absolute path, from this work tree. */
export async function loadPluginUnderTest() {
  const entry = path.join(pluginRoot, 'index.js')
  installResolveHook()
  return { entry, module: await import(pathToFileURL(entry).href) }
}

/** Refuse any document the host resolved outside the throwaway home. */
function assertInsideHome(home, label, document) {
  if (typeof document !== 'string' || document === '') return
  if (path.relative(home, path.resolve(document)).startsWith('..')) {
    throw new Error(`${label} escaped the fixture home: ${document} (expected under ${home})`)
  }
}

/**
 * The native half of the desktop bridge: the Electron main process in
 * production, this object here. Everything it records is what the real
 * `host-runtime-bridge.ts` actually transported.
 */
function createNativeRuntime(home, overrides = {}) {
  const calls = {
    requests: [],
    confirms: [],
    manualResults: [],
    downloadAndOpen: [],
    notifications: [],
    trays: [],
    localePreferences: [],
  }
  const state = {
    locale: overrides.locale ?? 'en',
    release: overrides.release,
    /** Replaced by a case to script one release endpoint at a time. */
    respond: overrides.respond,
    confirm: overrides.confirm ?? (async () => false),
  }
  let item
  const runtime = {
    platform: overrides.platform ?? 'win32',
    get locale() { return state.locale },
    updates: {
      isPackaged: overrides.isPackaged ?? true,
      canDownload: overrides.canDownload ?? true,
      currentVersion: overrides.currentVersion ?? '0.7.3',
      statePath: overrides.statePath ?? path.join(home, 'state', 'tokens-version-updates.json'),
      request: async (url, init) => {
        calls.requests.push({ url, init })
        if (state.respond === undefined) {
          return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return state.respond(url, init)
      },
      confirmDownload: async (version, channel) => {
        calls.confirms.push({ version, channel })
        return state.confirm(version)
      },
      showManualCheckResult: async (result) => { calls.manualResults.push(result) },
      downloadAndOpen: async (version) => { calls.downloadAndOpen.push(version) },
      notify: (notification) => { calls.notifications.push(notification) },
    },
    registerTrayItem(entry) {
      item = entry
      calls.trays.push({ group: entry.group, order: entry.order, label: entry.label() })
      return {
        refresh() { calls.trays.push({ group: entry.group, order: entry.order, label: entry.label() }) },
        dispose() { item = undefined; calls.trays.push({ disposed: true }) },
      }
    },
    schedule: () => async () => {},
    mountScheduled: async () => {},
    configureDeveloperLogging() {},
    show() {},
    notifyAttention() {},
    openTerminal() {},
    reloadRenderer() {},
    toggleDeveloperTools() {},
    exportDiagnostics: async () => undefined,
    pickDirectory: async () => undefined,
    validateDirectory: async () => undefined,
    platformLogin() {},
    reportRendererBoot() {},
    setLocalePreference(preference) {
      calls.localePreferences.push(preference)
      if (preference === 'zh' || preference === 'en') state.locale = preference
    },
    setThemeSource() {},
    requestRestart: async () => {},
    requestRecoveryRestart: async () => {},
    prepareToQuit() {},
    openProfileCreateWindow() {},
    openExternal: async () => {},
  }
  return { runtime, calls, state, tray: () => item }
}

/**
 * Boot a throwaway profile on the staged host with the real services this
 * plugin uses, and let the real Loader activate it.
 *
 * @param options.config - the plugin's loader entry config (merged over the product's).
 * @param options.omit - service entry ids to leave out, for reverse controls.
 * @param options.plugin - plugin module to activate (defaults to the one under test).
 * @param options.native - overrides for the scripted native (Electron) side.
 * @param options.skipPlugin - leave the plugin's entry out entirely.
 */
export async function startLiveHost(options = {}) {
  const host = await hostFacts()
  const appBoot = (await loadHostModule('@deepseek-ai/dsh-app-boot')).module
  const connectionPlugin = (await loadHostModule('@deepseek-ai/dsh-client-connection')).module
  const credentialsLocal = (await loadHostModule('@deepseek-ai/dsh-credentials-local')).module
  const bridge = await hostBridge()
  const plugin = options.plugin ?? (await loadPluginUnderTest()).module
  const omit = new Set(options.omit ?? [])

  const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'tokens-version-updates-host-')))
  const dir = path.join(home, 'profiles', 'test')
  appBoot.initProfile(dir, ['test-bundle'])
  const bundleDir = path.join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(path.join(home, 'package.json'), JSON.stringify({ name: 'tokens-version-updates-host-fixture' }))
  writeFileSync(path.join(bundleDir, 'package.json'), JSON.stringify({
    name: 'test-bundle',
    version: '1.0.0',
    dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))

  const credentialsDocument = path.join(home, 'credentials.yaml')
  const entries = []
  const add = (id, name, config) => {
    if (omit.has(id)) return
    entries.push(config === undefined ? { id, name } : { id, name, config })
  }
  add('web-server', 'cordis:web-server', { host: '127.0.0.1', port: 0 })
  // `path` AND `dshHome`: the provider falls back to the real `$DSH_HOME` when
  // a key is misspelled, and assertInsideHome() below refuses to continue then.
  add('credentials', 'cordis:credentials-local', { path: credentialsDocument, dshHome: home, watch: false })
  add('connection', 'cordis:connection', {})
  if (options.skipPlugin !== true) {
    add(ENTRY_ID, `cordis:${ENTRY_ID}`, {
      ...PRODUCT_CONFIG,
      enabled: false,
      ...(options.config ?? {}),
    })
  }
  writeFileSync(path.join(bundleDir, 'cordis.patch.yml'), JSON.stringify([{ insert: entries }]))
  const configPath = path.join(dir, 'cordis.yml')
  writeFileSync(configPath, '[]')

  let profile
  let patches
  if (host.hasReadProfilePatches) {
    profile = {
      name: 'test',
      startedBundles: ['test-bundle'],
      dir,
      patchPath: path.join(dir, 'cordis.patch.yml'),
      installAnchor: path.join(home, 'package.json'),
      cwd: home,
      home,
      overlays: [],
      telemetryDisabledEnv: undefined,
    }
    patches = appBoot.readProfilePatches('test', profile)
  } else {
    // DSH 0.1 has no readProfilePatches; its launcher loads the profile
    // directory and composes the layers it finds there.
    const loaded = appBoot.loadProfileDirectory('test', dir, path.join(home, 'package.json'))
    profile = { ...loaded, home, cwd: home, installAnchor: path.join(home, 'package.json') }
    patches = loaded.layers.flatMap(layer => layer.patches ?? layer)
  }

  const native = createNativeRuntime(home, options.native ?? {})
  const listeners = [undefined, undefined]
  const endpoint = index => ({
    send(message) {
      const copy = structuredClone(message)
      queueMicrotask(() => listeners[1 - index]?.(copy))
    },
    listen(callback) { listeners[index] = callback; return () => { listeners[index] = undefined } },
  })
  const nativeRpc = new bridge.HostRpc(endpoint(0), 10_000)
  const hostRpc = new bridge.HostRpc(endpoint(1), 10_000)
  const unbind = bridge.bindNativeRuntime(nativeRpc, native.runtime)
  const desktopRuntime = bridge.createHostRuntime(hostRpc, bridge.runtimeSnapshot(native.runtime))

  const teardown = async (ctx) => {
    try {
      if (ctx !== undefined) await ctx.fiber.dispose()
    } finally {
      await unbind().catch(() => undefined)
      hostRpc.close()
      nativeRpc.close()
      rmSync(home, { recursive: true, force: true })
    }
  }

  let ctx
  try {
    ctx = await appBoot.boot('test', configPath, patches, (bootCtx) => {
      bootCtx.provide('profileContext', profile)
      bootCtx.provide('appReady', { onReady: (listener) => { listener(); return () => {} } })
      if (!omit.has('desktopRuntime')) bootCtx.provide('desktopRuntime', desktopRuntime)
      bootCtx.provide('webStartup', { host: '127.0.0.1', port: 0, trustedHosts: [] })
      Object.assign(bootCtx.loader.builtins, {
        'web-server': bridge.DesktopWebServer,
        'credentials-local': credentialsLocal.default ?? credentialsLocal,
        connection: connectionPlugin,
        [ENTRY_ID]: plugin,
      })
    })
  } catch (error) {
    await teardown(undefined)
    throw error
  }

  try {
    assertInsideHome(home, 'profile directory', profile.dir)
    assertInsideHome(home, 'credentials document', ctx.get('credentials')?.documentPath)
    assertInsideHome(home, 'credentials document', credentialsDocument)
    assertInsideHome(home, 'update prompt state', native.runtime.updates.statePath)
  } catch (error) {
    await teardown(ctx)
    throw error
  }

  const server = ctx.get('webServer')
  const origin = server === undefined
    ? undefined
    : typeof server.getOrigin === 'function'
      ? (value => (value.startsWith('http') ? value : `http://${value}`))(server.getOrigin())
      : `http://${server.host}:${String(server.port)}`

  return {
    ctx,
    host,
    home,
    profile,
    origin,
    credentialsDocument,
    statePath: native.runtime.updates.statePath,
    desktopRuntime,
    native,
    nativeCalls: native.calls,
    tray: native.tray,
    /** The Cookie the real host mints for an authenticated browser page. */
    browserCookie: () => mintBrowserCookie(ctx, origin),
    dispose: () => teardown(ctx),
  }
}

/**
 * Walk the host's own browser-token exchange to obtain the Cookie a real page
 * would carry: `authenticatedUrl()` mints the launch token, `authorizeIndex()`
 * validates it and owns the Set-Cookie. The fixture only plays the carrier.
 */
export function mintBrowserCookie(ctx, origin) {
  const tokenUrl = new URL(ctx.connection.authenticatedUrl(`${origin}/`))
  let cookie
  ctx.connection.authorizeIndex(
    {
      method: 'GET',
      url: `${tokenUrl.pathname}${tokenUrl.search}`,
      headers: { host: tokenUrl.host },
    },
    {
      writeHead(_status, headers) { cookie = headers?.['set-cookie'] },
      end() {},
    },
  )
  if (typeof cookie !== 'string') throw new Error('the host refused to mint a browser cookie')
  return cookie.split(';')[0]
}

/**
 * One raw HTTP request at a real origin with the headers exactly as given.
 *
 * `fetch` refuses to set `Host`, which the host's trust fence reads first, so
 * the fence controls cannot be written with it.
 */
export async function rawRequest(origin, options) {
  const target = new URL(options.path, origin)
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) }
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method ?? 'POST',
      headers,
      setHost: !Object.keys(headers).some(name => name.toLowerCase() === 'host'),
    }, (response) => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let body
        try { body = JSON.parse(text) } catch { body = undefined }
        resolve({ status: response.statusCode, headers: response.headers, body, text })
      })
    })
    request.on('error', reject)
    if (options.body !== undefined) request.write(JSON.stringify(options.body))
    request.end()
  })
}

/** The real fetch, for the fixture's own loopback traffic. */
export function fixtureFetch(input, init) {
  return realFetch(input, init)
}

/** A GitHub Release document in the shape the plugin parses. */
export function releaseDocument(version, assets = []) {
  return {
    draft: false,
    prerelease: false,
    tag_name: `v${version}`,
    assets: assets.map(asset => ({
      name: asset.name,
      browser_download_url: asset.url,
      size: asset.size,
      ...(asset.digest === undefined ? {} : { digest: asset.digest }),
    })),
  }
}

/** JSON response helper for a scripted release endpoint. */
export function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
