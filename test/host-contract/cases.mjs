/**
 * Real-host contract cases: every host interface this plugin uses, called once
 * against a staged host that is never stubbed. See `docs/host-interfaces.md`
 * for the interface-to-case table and the three scripted boundaries.
 *
 * House rules, from T0047:
 *  - Assert only what the plugin depends on. A host that adds a field, an
 *    event, a route, or a tray group stays compatible.
 *  - Prefer the host's own judgement (its compatibility evaluator, its
 *    Loader, its trust fence, its cookie mint) over an expectation written
 *    here.
 *  - No "both sides fall back to the same default" assertions: every case has
 *    a mutation in `scripts/verify-host-contract-mutations.mjs` that must make
 *    exactly this case red.
 *  - Never execute silently: a case that cannot run says NOT EXECUTED with a
 *    reason, and only a `host-generation:` or `platform:` reason is allowed to
 *    pass the gate.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  PRIMITIVE_NAMES,
  SIDEBAR_SLOT,
  hostExportNames,
  sidebarSlotSpec,
  startClientRuntime,
} from './client-runtime.mjs'
import {
  ENTRY_ID,
  PRODUCT_CONFIG,
  RPC_CHANNEL,
  fixtureFetch,
  hostFacts,
  jsonResponse,
  loadHostModule,
  loadPluginUnderTest,
  missingHost,
  pluginManifest,
  pluginRoot,
  rawRequest,
  releaseDocument,
  startLiveHost,
} from './live-host.mjs'

/** The path the plugin registers on the host WebServer. */
const UPDATE_ROUTE = '/api/desktop/updates/check'

/** The three runtimes this product line stages, newest first. */
const STAGED_RUNTIMES = ['0.2.1-rc.2', '0.2.0-rc.2', '0.1.5-rc.2']

function notExecuted(t, reason) {
  t.skip(`NOT EXECUTED: ${reason}`)
}

/** Wait for a condition the host reaches asynchronously, or fail with its last state. */
async function until(describe, predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${describe}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

/** A release the plugin will treat as strictly newer than the fixture's 0.7.3. */
function newerRelease(version = '9.9.9', assets = []) {
  return releaseDocument(version, assets)
}

/** The installer asset name for this platform, or undefined when there is none. */
function installerAssetName(version) {
  const key = `${process.platform}:${process.arch}`
  const suffix = {
    'win32:x64': 'windows-amd64-installer.exe',
    'darwin:arm64': 'macos-arm64-installer.dmg',
    'darwin:x64': 'macos-amd64-installer.dmg',
  }[key]
  return suffix === undefined ? undefined : `TokensHarness-${version}-${suffix}`
}

/**
 * Register every host-contract case on node:test.
 *
 * Each case boots its own throwaway host: the services are cheap next to the
 * cost of one case leaking state into the next, and the gate runs them with
 * `--test-concurrency=1` on a memory-tight machine.
 */
export async function registerHostContractCases() {
  const absent = missingHost()
  const facts = absent ? undefined : await hostFacts()
  /** Boot, run, dispose — never leave a profile or an RPC pair behind. */
  const live = async (options, body) => {
    const host = await startLiveHost(options)
    try {
      return await body(host)
    } finally {
      await host.dispose()
    }
  }
  /** Declare one case; `requires` returns a reason string when it cannot run. */
  const host0 = (id, title, requires, body) => {
    test(`${id} ${title}`, async (t) => {
      if (absent) return notExecuted(t, absent)
      const reason = requires === undefined ? undefined : await requires(facts)
      if (reason !== undefined) return notExecuted(t, reason)
      await body(t, facts)
    })
  }
  /**
   * Cases that need the plugin to actually activate.
   *
   * Only a host whose own evaluator refuses this plugin is skipped, and the
   * reason names the declared range rather than a version this file matched.
   * A host with no evaluator (DSH 0.1) is attempted anyway: a blanket skip
   * there would hide whatever the plugin really does on it.
   */
  const supported = (f) => f.supportsPlugin === false
    ? `host-generation: runtime ${f.runtimeVersion} is outside this plugin's declared`
      + ` @deepseek-ai/dsh peer range ${pluginManifest().peerDependencies['@deepseek-ai/dsh']},`
      + ' as the host\'s own evaluator judges it; HOST-018 covers the declaration itself'
    : undefined
  /** Cases that exercise the browser half, which targets the DSH 0.2 renderer. */
  const modernClient = (f) => f.legacyClientRuntime
    ? 'host-generation: this host ships the pre-0.2 browser runtime (no SlotCore.registerFactory,'
      + ' and its primitives package still uses the 0.1 icon export names);'
      + " this plugin's client half targets the DSH 0.2 renderer"
    : undefined

  /* ---------------------------------------------------------------- *
   * Loader, identity and configuration
   * ---------------------------------------------------------------- */

  host0('HOST-001', 'the real Loader activates this work tree through the declared inject', supported,
    async () => {
      const { entry } = await loadPluginUnderTest()
      // The staged host pins its own copy of every builtin plugin. If the
      // Loader ever resolved that copy instead of this work tree, every case
      // below would be green while testing shipped code.
      assert.equal(path.relative(pluginRoot, entry).startsWith('..'), false,
        'the plugin under test must be this work tree')
      const facts2 = await hostFacts()
      assert.equal(path.relative(facts2.root, entry).startsWith('..'), true,
        `the plugin under test resolved inside the staged host (${entry})`)

      await live({}, async (host) => {
        const plugin = (await loadPluginUnderTest()).module
        assert.deepEqual([...plugin.inject], ['desktopRuntime', 'webServer'],
          'the declared inject list is what the Loader waits for')
        // Activation is observable through the real services, on every host
        // generation: a tray item on the native side and a bound route.
        assert.ok(host.tray() !== undefined, 'the Loader did not activate the plugin')
        assert.equal(typeof host.ctx.get('webServer').port, 'number')
      })
    })

  host0('HOST-002', 'an unsatisfied inject keeps the plugin off the real host', supported,
    async () => {
      // DSH 0.1 fails the boot outright on an inactive entry while 0.2 only
      // warns, so the control accepts either answer and asserts the effect.
      let booted
      try {
        booted = await startLiveHost({ omit: ['desktopRuntime'] })
      } catch {
        return
      }
      try {
        assert.equal(booted.tray(), undefined,
          'the plugin ran without the desktopRuntime it declares')
        const response = await rawRequest(booted.origin, {
          path: UPDATE_ROUTE,
          headers: { origin: booted.origin },
          body: {},
        })
        // Connection owns every unclaimed path, so an absent route answers 401
        // rather than 404; what matters is that the plugin did not accept it.
        assert.notEqual(response.status, 200,
          'the plugin registered its route without the service it declares')
      } finally {
        await booted.dispose()
      }
    })

  host0('HOST-003', 'the product entry config reaches apply through the real Config pipeline',
    supported, async () => {
      // The product's own cordis.patch.yml row, verbatim. The assertion is on
      // behaviour, not on a config object: the configured index URL is the one
      // the plugin asks the host adapter for.
      await live({}, async (host) => {
        await host.tray().invoke()
        await until('the first release request', () => host.nativeCalls.requests.length > 0)
        assert.equal(host.nativeCalls.requests[0].url, PRODUCT_CONFIG.releaseIndexURL)
      })
      // The product's own URL happens to equal the one derived from its
      // owner/repo, so the check above would still pass if the plugin ignored
      // the configured value entirely. This override cannot be derived.
      const override = 'https://updates.host-contract.test/releases.json'
      await live({ config: { releaseIndexURL: override } }, async (host) => {
        await host.tray().invoke()
        await until('the overridden release request', () => host.nativeCalls.requests.length > 0)
        assert.equal(host.nativeCalls.requests[0].url, override)
      })
      // A row that only names a repository derives both endpoints from it,
      // which is the documented fallback and the only other shape in use.
      await live({
        config: {
          githubOwner: 'HostContractOwner',
          githubRepo: 'host-contract-repo',
          releaseIndexURL: '',
          releaseAPIURL: '',
        },
      }, async (host) => {
        await host.tray().invoke()
        await until('the derived release request', () => host.nativeCalls.requests.length > 0)
        assert.equal(
          host.nativeCalls.requests[0].url,
          'https://hostcontractowner.github.io/host-contract-repo/releases.json',
        )
      })
    })

  /* ---------------------------------------------------------------- *
   * desktopRuntime, across the host's own native bridge
   * ---------------------------------------------------------------- */

  host0('HOST-004', 'the update adapter snapshot survives the real runtime bridge', supported,
    async () => {
      await live({}, async (host) => {
        const adapter = host.desktopRuntime.updates
        // Only the fields this plugin reads; the bridge carries more.
        assert.equal(adapter.isPackaged, true)
        assert.equal(adapter.canDownload, true)
        assert.equal(adapter.currentVersion, '0.7.3')
        assert.equal(adapter.statePath, host.statePath)
        assert.equal(typeof adapter.request, 'function')
        assert.equal(typeof adapter.confirmDownload, 'function')
        assert.equal(typeof adapter.showManualCheckResult, 'function')
      })
    })

  host0('HOST-005', 'the release check travels the bridge request and returns a real Response',
    supported, async () => {
      const seen = []
      await live({
        native: {
          respond: (url) => {
            seen.push(url)
            return jsonResponse([newerRelease()])
          },
        },
      }, async (host) => {
        await host.tray().invoke()
        await until('the release request', () => seen.length > 0)
        assert.deepEqual(seen, [PRODUCT_CONFIG.releaseIndexURL])
        // The bridge rebuilds the Response on the Host side from a serialised
        // body/status/headers triple. The plugin only works if that round trip
        // preserves the JSON body and a 200 status.
        const call = host.nativeCalls.requests[0]
        const headers = new Headers(call.init.headers)
        assert.equal(headers.get('user-agent'), PRODUCT_CONFIG.productName,
          'the product name must reach GitHub as the User-Agent')
        assert.equal(headers.get('accept'), 'application/vnd.github+json')
        // The update really was observed: the tray label now names the version.
        await until('the tray label to announce the update',
          () => host.tray().label().includes('9.9.9'))
      })
    })

  host0('HOST-006', 'the configured fallback endpoint is used when the index fails', supported,
    async () => {
      const seen = []
      await live({
        native: {
          respond: (url) => {
            seen.push(url)
            if (url === PRODUCT_CONFIG.releaseIndexURL) return jsonResponse({ error: 'nope' }, 503)
            return jsonResponse(newerRelease())
          },
        },
      }, async (host) => {
        await host.tray().invoke()
        await until('both endpoints', () => seen.length >= 2)
        assert.deepEqual(seen, [PRODUCT_CONFIG.releaseIndexURL, PRODUCT_CONFIG.releaseAPIURL])
        await until('the tray label to announce the update',
          () => host.tray().label().includes('9.9.9'))
      })
    })

  host0('HOST-007', 'tray copy follows the locale the bridge reports, including a later change',
    supported, async () => {
      await live({ native: { locale: 'en' } }, async (host) => {
        assert.equal(host.tray().label(), 'Check Updates…')
        // The bridge owns locale: it asks the native side and republishes every
        // tray item. The plugin must read it live, not latch it at activation.
        host.desktopRuntime.setLocalePreference('zh')
        await until('the republished Chinese tray label',
          () => host.tray().label() === '检查更新…')
        assert.deepEqual(host.nativeCalls.localePreferences.includes('zh'), true)
      })
    })

  host0('HOST-008', 'the tray contribution reaches the native side with its group and order',
    supported, async () => {
      await live({}, async (host) => {
        const first = host.nativeCalls.trays[0]
        assert.equal(first.group, 'status')
        assert.equal(first.order, 10)
        assert.equal(first.label, 'Check Updates…')
        // refresh() is the only way the plugin updates a tray label; a bridge
        // that stopped republishing would leave the menu stale forever.
        const before = host.nativeCalls.trays.length
        host.desktopRuntime.setLocalePreference('zh')
        await until('a republish', () => host.nativeCalls.trays.length > before)
      })
    })

  host0('HOST-009', 'invoking the tray item from the native side runs exactly one check',
    supported, async () => {
      await live({ native: { respond: () => jsonResponse([newerRelease()]) } }, async (host) => {
        await host.tray().invoke()
        await until('the check', () => host.nativeCalls.requests.length > 0)
        const after = host.nativeCalls.requests.length
        // A second invoke with a version already in hand must not re-query:
        // the plugin owns the single-flight, the host only delivers the click.
        await host.tray().invoke()
        assert.equal(host.nativeCalls.requests.length, after)
      })
    })

  host0('HOST-010', 'the adapter confirmation and result dialogs carry the real result shape',
    supported, async () => {
      // Up to date: the plugin reports through showManualCheckResult. The
      // installed version sits in the document the way the product publishes
      // it — marked a GitHub prerelease — so its release notes ride along.
      const notes = ['# TokensCowork v0.7.3', '', '这一版修了检查更新。', '',
        '## 本次更新', '', '### 🐛 问题修复', '', '- 修好了那个按钮。', ''].join('\n')
      await live({
        native: {
          respond: () => jsonResponse([
            { ...releaseDocument('0.7.3'), prerelease: true, body: notes },
            releaseDocument('0.1.0'),
          ]),
        },
      },
        async (host) => {
          await host.tray().invoke()
          await until('the manual result', () => host.nativeCalls.manualResults.length > 0)
          const result = host.nativeCalls.manualResults[0]
          assert.equal(result.status, 'up-to-date')
          assert.equal(result.currentVersion, '0.7.3')
          // The result crosses the real Host bridge. The dialog has nothing to
          // show unless the notes text survives that serialisation intact.
          assert.equal(result.notes, notes)
        })
      // Update available: the plugin asks the adapter to confirm the download.
      await live({ native: { respond: () => jsonResponse([newerRelease()]) } }, async (host) => {
        await host.tray().invoke()
        await until('the confirmation', () => host.nativeCalls.confirms.length > 0)
        assert.equal(host.nativeCalls.confirms[0].version, '9.9.9')
      })
    })

  /* ---------------------------------------------------------------- *
   * webServer
   * ---------------------------------------------------------------- */

  host0('HOST-011', 'the exact route is served by the real host WebServer', supported,
    async () => {
      await live({ native: { respond: () => jsonResponse([releaseDocument('0.1.0')]) } },
        async (host) => {
          const response = await rawRequest(host.origin, {
            path: UPDATE_ROUTE,
            headers: { origin: host.origin },
            body: {},
          })
          assert.equal(response.status, 200)
          assert.deepEqual(response.body, { accepted: true })
          await until('the check the route triggered',
            () => host.nativeCalls.requests.length > 0)
        })
    })

  host0('HOST-012', 'the route fence is built from the port the real WebServer bound', supported,
    async () => {
      await live({}, async (host) => {
        const wrongOrigin = await rawRequest(host.origin, {
          path: UPDATE_ROUTE,
          headers: { origin: 'http://127.0.0.1:1' },
          body: {},
        })
        assert.equal(wrongOrigin.status, 403,
          'an origin naming another port must not pass the same-origin fence')
        const crossSite = await rawRequest(host.origin, {
          path: UPDATE_ROUTE,
          headers: { origin: host.origin, 'sec-fetch-site': 'cross-site' },
          body: {},
        })
        assert.equal(crossSite.status, 403)
        const wrongMethod = await rawRequest(host.origin, {
          path: UPDATE_ROUTE,
          method: 'GET',
          headers: { origin: host.origin },
        })
        assert.equal(wrongMethod.status, 405)
        assert.equal(host.nativeCalls.requests.length, 0,
          'a refused request must not reach the release source')
      })
    })

  /* ---------------------------------------------------------------- *
   * connection (the optional service the sidebar half talks to)
   * ---------------------------------------------------------------- */

  host0('HOST-013', 'the RPC channel is registered on the real Connection and answers status',
    supported, async () => {
      await live({}, async (host) => {
        const response = await rpcCall(host, 'status')
        assert.equal(response.status, 200)
        assert.equal(response.body.result.ok, true)
        const value = response.body.result.value
        // Only the fields the sidebar reads.
        assert.equal(value.productName, PRODUCT_CONFIG.productName)
        assert.ok(['idle', 'checking', 'available', 'downloading'].includes(value.phase))
      })
    })

  host0('HOST-014', 'the download endpoint answers on the same real channel', supported,
    async () => {
      await live({}, async (host) => {
        const response = await rpcCall(host, 'download')
        assert.equal(response.status, 200)
        assert.equal(response.body.result.ok, true)
        // Nothing is available yet, so the honest answer is "not started".
        assert.deepEqual(response.body.result.value, { started: false })
        const unknown = await rpcCall(host, 'nosuchendpoint')
        assert.equal(unknown.body.result.ok, false)
      })
    })

  host0('HOST-015', "Connection's own authentication fence guards the channel", supported,
    async () => {
      await live({}, async (host) => {
        const anonymous = await rawRequest(host.origin, {
          path: `${RPC_CHANNEL}/status`,
          body: { type: 'client-request', rpcId: 'fixture-anon', method: 'status', payload: {} },
        })
        assert.equal(anonymous.status, 401,
          'the channel must not answer an unauthenticated request')
        const forged = await rawRequest(host.origin, {
          path: `${RPC_CHANNEL}/status`,
          headers: { host: 'evil.test' },
          body: { type: 'client-request', rpcId: 'fixture-forged', method: 'status', payload: {} },
        })
        assert.equal(forged.status, 403, 'the host trust fence must refuse a forged Host header')
      })
    })

  /* ---------------------------------------------------------------- *
   * dsh-atomic-write and the adapter state path
   * ---------------------------------------------------------------- */

  host0('HOST-016', "the prompt state is written atomically at the adapter's state path",
    supported, async () => {
      await live({ native: { respond: () => jsonResponse([newerRelease()]) } }, async (host) => {
        assert.equal(existsSync(path.dirname(host.statePath)), false,
          'the fixture must start without the state directory, so creating it is observable')
        await host.tray().invoke()
        await until('the state file', () => existsSync(host.statePath))
        const state = JSON.parse(readFileSync(host.statePath, 'utf8'))
        assert.equal(state.version, 2)
        assert.equal(state.lastPromptedVersion, '9.9.9')
        if (process.platform !== 'win32') {
          // The host package is asked for 0o600/0o700; POSIX is where that is
          // observable at all.
          assert.equal(statSync(host.statePath).mode & 0o777, 0o600)
        }
      })
      const atomic = await loadHostModule('@deepseek-ai/dsh-atomic-write')
      assert.equal(typeof atomic.module.writeFileAtomic, 'function',
        'the staged host must still export the writer this plugin imports')
    })

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  host0('HOST-017', 'disposing the real fiber withdraws every contribution', supported,
    async () => {
      const host = await startLiveHost({})
      try {
        const origin = host.origin
        assert.ok(host.tray() !== undefined)
        assert.equal(
          (await rawRequest(origin, { path: UPDATE_ROUTE, headers: { origin }, body: {} })).status,
          200,
        )
        assert.equal((await rpcCall(host, 'status')).body.result.ok, true)

        // Dispose only this plugin's own Loader entry. Tearing the whole host
        // down would close the listener, and then a withdrawn route and a dead
        // server look identical — the case would pass even if the plugin
        // leaked both contributions.
        const entry = [...host.ctx.get('loader').entries()]
          .find(row => row?.options?.id === ENTRY_ID)
        assert.notEqual(entry, undefined, 'the Loader does not list this plugin entry')
        await entry.fiber.dispose()

        assert.equal(host.tray(), undefined, 'the tray contribution outlived the fiber')
        const after = await rawRequest(origin, { path: UPDATE_ROUTE, headers: { origin }, body: {} })
        assert.notEqual(after.status, 200, 'the route outlived the fiber')
        assert.notEqual((await rpcCall(host, 'status')).body?.result?.ok, true,
          'the RPC channel outlived the fiber')
      } finally {
        // Without this a failing assertion leaves the listener and the RPC pair
        // open, and the whole worker hangs instead of reporting the failure.
        await host.dispose()
      }
    })

  /* ---------------------------------------------------------------- *
   * The declaration the host gates on
   * ---------------------------------------------------------------- */

  host0('HOST-018', "the host's own evaluator accepts this plugin on every supported runtime",
    f => f.hasCompatibilityEvaluator
      ? undefined
      : `host-generation: app-boot ${f.runtimeVersion} has no evaluatePluginCompatibility`
        + ' (any 0.2 host judges all three runtimes, so the matrix stays complete)',
    async () => {
      const { module: appBoot } = await loadHostModule('@deepseek-ai/dsh-app-boot')
      const manifest = pluginManifest()
      const verdicts = Object.fromEntries(STAGED_RUNTIMES.map(version =>
        [version, appBoot.evaluatePluginCompatibility(manifest, {}, version) === undefined]))
      // The declared range is `>=0.2.0-rc.2 <0.3.0-0`: the two 0.2 runtimes the
      // product ships must be accepted, and the 0.1 line must not be, because
      // this plugin has never been validated there.
      assert.equal(verdicts['0.2.1-rc.2'], true)
      assert.equal(verdicts['0.2.0-rc.2'], true)
      assert.equal(verdicts['0.1.5-rc.2'], false)
      // Reverse control on the same path: a range this runtime cannot satisfy
      // must be reported unmet, or the three verdicts above prove nothing.
      const impossible = {
        ...manifest,
        peerDependencies: { ...manifest.peerDependencies, '@deepseek-ai/dsh': '>=99.0.0' },
      }
      const refused = appBoot.evaluatePluginCompatibility(impossible, {}, '0.2.1-rc.2')
      assert.notEqual(refused, undefined)
      // DSH 0.2.0 names the unmet map `peers`, 0.2.1 renamed it `requirements`;
      // the plugin reads neither, so the case accepts both spellings.
      const unmet = refused.requirements ?? refused.peers
      assert.ok(Object.keys(unmet).includes('@deepseek-ai/dsh'))
    })

  /* ---------------------------------------------------------------- *
   * The installer handoff
   * ---------------------------------------------------------------- */

  host0('HOST-019', 'installer bytes bypass the host IPC and land under the configured directory',
    (f) => {
      const unsupported = supported(f)
      if (unsupported !== undefined) return unsupported
      return installerAssetName('9.9.9') === undefined
        ? `platform: no installer asset is published for ${process.platform}/${process.arch}`
        : undefined
    },
    async (t) => {
      const version = '9.9.9'
      const name = installerAssetName(version)
      const payload = Buffer.from('tokenscowork-host-contract-installer-fixture')
      const digest = `sha256:${createHash('sha256').update(payload).digest('hex')}`
      const assetUrl = `https://github.com/${PRODUCT_CONFIG.githubOwner}/${PRODUCT_CONFIG.githubRepo}/releases/download/v${version}/${name}`
      const downloads = []
      const originalFetch = globalThis.fetch
      globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : String(input.url ?? input)
        if (url === assetUrl) {
          downloads.push(url)
          return new Response(payload, {
            status: 200,
            headers: { 'content-length': String(payload.byteLength) },
          })
        }
        return originalFetch(input, init)
      }
      t.after(() => { globalThis.fetch = originalFetch })

      const release = newerRelease(version, [{ name, url: assetUrl, size: payload.byteLength, digest }])
      // The adapter declines, so the tray click only discovers the update; the
      // handoff is then driven through the RPC endpoint, which answers only
      // once the whole download and installer handoff has settled. Waiting on
      // the file instead would race on the second run, where it already exists.
      // (The confirmation path itself is HOST-010's.)
      const run = async (directory) => await live({
        config: { downloadDirectory: directory },
        native: { respond: () => jsonResponse([release]), confirm: async () => false },
      }, async (host) => {
        await host.tray().invoke()
        await until('the tray to offer the update', () => host.tray().label().includes(version))
        const response = await rpcCall(host, 'download')
        assert.equal(response.status, 200)
        assert.equal(response.body.result.ok, true)
        // The host's text-only IPC must never be asked to carry installer bytes.
        assert.equal(
          host.nativeCalls.requests.some(call => call.url === assetUrl), false,
          'installer bytes went through the host update request adapter',
        )
        assert.equal(existsSync(path.join(directory, version, name)), true,
          'the verified installer is not where the configured directory puts it')
        return path.join(directory, version, name)
      })

      // A fresh directory per run, removed afterwards: a leftover installer
      // from an earlier run would make the first download look like a reuse.
      const directory = mkdtempSync(path.join(tmpdir(), 'tokens-version-updates-host-contract-'))
      t.after(() => { rmSync(directory, { recursive: true, force: true }) })
      const file = await run(directory)
      assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), digest.slice(7))
      assert.equal(downloads.length, 1)
      // Second run: a verified file already on disk is reused, so no second
      // transfer. That is the only observable difference between the two runs.
      await run(directory)
      assert.equal(downloads.length, 1, 'an already verified installer must not be downloaded again')
    })

  host0('HOST-020', 'a host that reports canDownload false is never asked to install', supported,
    async () => {
      await live({
        native: { canDownload: false, respond: () => jsonResponse([newerRelease()]) },
      }, async (host) => {
        await host.tray().invoke()
        await until('the manual result', () => host.nativeCalls.manualResults.length > 0)
        assert.equal(host.nativeCalls.confirms.length, 0,
          'the plugin offered a download on a host that cannot install one')
        assert.equal(host.tray().label(), 'Check Updates…',
          'the tray must not advertise a download this host cannot perform')
      })
    })

  /* ---------------------------------------------------------------- *
   * The browser half
   * ---------------------------------------------------------------- */

  host0('HOST-021', "the shipped client bundle takes a seat in the host's real slot registry",
    modernClient, async () => {
      const client = await startClientRuntime({})
      try {
        assert.ok(client.registeredBundles().includes('@tokens/dsh-version-updates'),
          "the host's module-loader protocol did not accept dist/client.js")
        assert.notEqual(client.spec, undefined,
          `the staged host no longer declares ${SIDEBAR_SLOT}`)

        const plugin = client.pluginClient()
        assert.deepEqual([...plugin.inject], ['slots', 'connection'])
        // The plugin reads `connection` out of the Context; the live round trip
        // is HOST-023's job, so this case only needs the seat to form.
        client.ctx.provide('connection')
        client.ctx.connection = { rpc: { call: async () => ({ ok: true, value: {} }) } }
        plugin.apply(client.ctx)

        // The real SlotRegistry accepted the seat: a slot the host stopped
        // declaring, or a kind the plugin registered wrongly, throws here.
        const seats = client.seats()
        assert.equal(seats.length, 1)
        assert.equal(seats[0].options.id, 'tokens-version-updates')
        assert.equal(seats[0].options.order, 10)
        assert.equal(typeof seats[0].inject, 'function')
      } finally {
        client.dispose()
      }
    })

  host0('HOST-023', "the sidebar seat's face reaches the live host over the real Connection",
    async (f) => {
      const unsupported = supported(f) ?? modernClient(f)
      if (unsupported !== undefined) return unsupported
      const probe = await startClientRuntime({})
      const composable = probe.composableConnection
      probe.dispose()
      return composable
        ? undefined
        : 'host-generation: this client Connection has no installConnection()'
          + ' composition entry point (added in DSH 0.2.1); HOST-013/014 cover the same'
          + ' endpoints over the real wire'
    },
    async () => {
      const host = await startLiveHost({})
      let client
      try {
        client = await startClientRuntime({ origin: host.origin, cookie: host.browserCookie() })
        assert.ok(client.connectionInstalled, 'the real browser Connection was not installed')
        const plugin = client.pluginClient()
        plugin.apply(client.ctx)
        const seat = client.seats()[0]
        assert.notEqual(seat, undefined)
        // The face is the only thing the component calls, and every call goes
        // over the real Connection to the real host half.
        const face = seat.inject()
        const status = await face.readStatus()
        assert.equal(status.productName, PRODUCT_CONFIG.productName)
        assert.ok(['idle', 'checking', 'available', 'downloading'].includes(status.phase))
        assert.equal(await face.download(), false,
          'the host half must report an unstarted download honestly')
      } finally {
        client?.dispose()
        await host.dispose()
      }
    })

  host0('HOST-022', 'the names the client bundle resolves at render time still exist on this host',
    modernClient, async () => {
      // The client build keeps @deepseek-ai/* external, so these are resolved
      // by the host when the component first renders — which, for this plugin,
      // is only when an update is available. Nothing else catches a rename.
      const exported = hostExportNames('@deepseek-ai/dsh-client-ui-primitives')
      assert.ok(exported.size > 0, 'no export names could be read from the staged primitives package')
      // Reverse control: the reader must be able to report an absent name.
      assert.equal(exported.has('TokensAbsentExportProbe'), false)
      const bundle = readFileSync(path.join(pluginRoot, 'dist', 'client.js'), 'utf8')
      for (const name of PRIMITIVE_NAMES) {
        assert.ok(exported.has(name), `the staged host no longer exports ${name}`)
        assert.ok(bundle.includes(name), `dist/client.js is stale: it does not reference ${name}`)
      }
      assert.notEqual(sidebarSlotSpec(), undefined,
        `the staged host's sidebar no longer declares ${SIDEBAR_SLOT}`)
      // Only the names the plugin declares it needs; a host that adds more
      // client packages stays compatible.
      for (const specifier of pluginManifest().dsh.client.inject) {
        assert.doesNotThrow(
          () => createRequire(path.join(facts.root, 'package.json')).resolve(`${specifier}/package.json`),
          `dsh.client.inject names ${specifier}, which this host does not ship`,
        )
      }
    })
}

/** One authenticated RPC call over the real wire the browser half uses. */
async function rpcCall(host, endpoint) {
  return await rawRequest(host.origin, {
    path: `${RPC_CHANNEL}/${endpoint}`,
    headers: { cookie: host.browserCookie(), origin: host.origin },
    body: { type: 'client-request', rpcId: `fixture-${endpoint}`, method: endpoint, payload: {} },
  })
}

void ENTRY_ID
void fixtureFetch
