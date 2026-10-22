/**
 * Mutation verification for the real-host contract cases.
 *
 * A contract case that cannot go red is theatre. T0047 found one in another
 * plugin: a "the wrapper forwards the policy" case where both sides fell back
 * to the same host default, so the plugin could stop forwarding entirely and
 * the case stayed green. This script breaks one path at a time and requires
 * EXACTLY the cases that cover it to turn red — too few means the case is
 * vacuous, too many means it is written so tightly that an ordinary host
 * upgrade will redden unrelated cases.
 *
 * Nothing is edited in place. Each mutation is applied to a throwaway copy of
 * the plugin's shipped files, and `TOKENS_PLUGIN_ROOT` points the fixture at
 * that copy. A few mutations instead break the fixture's own forgery or its
 * scripted native adapter: those are marked `fixture`, and they exist for the
 * cases whose subject is a host-owned fence or a host-owned projection, which
 * no plugin edit can reach.
 *
 * Usage: DSH_HOST_ROOT=<staged>/dsh-plugin-desktop node scripts/verify-host-contract-mutations.mjs
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { summariseCaseReport } from './test-report-summary.mjs'

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const runner = path.join(repositoryRoot, 'test', 'run-test-cases.mjs')

/** Files a mutated copy needs: everything the plugin publishes, plus the manifest. */
const COPIED = [
  'index.js', 'download.js', 'identity.js', 'messages.js', 'index.d.ts',
  'cordis.patch.yml', 'package.json', 'dist',
]

/** Cases that mount the browser half; the rest never pay the jsdom cost. */
const CLIENT_CASES = ['HOST-021', 'HOST-022', 'HOST-023']

/**
 * One mutation: where it bites, what it changes, and exactly which cases must
 * go red. `scope` picks the case subset that is run, so a host-side mutation
 * does not re-run the browser half and vice versa.
 */
const MUTATIONS = [
  {
    id: 'inject-declaration',
    note: 'the Loader is told the plugin needs only one of its two services',
    edits: [['index.js',
      "export const inject = ['desktopRuntime', 'webServer']",
      "export const inject = ['webServer']"]],
    expect: ['HOST-001'],
  },
  {
    id: 'inject-gate',
    scope: 'fixture',
    note: 'the fixture provides desktopRuntime even when the control asked it not to,'
      + ' so the Loader gate is no longer being observed',
    edits: [['test/host-contract/live-host.mjs',
      "      if (!omit.has('desktopRuntime')) bootCtx.provide('desktopRuntime', desktopRuntime)",
      "      bootCtx.provide('desktopRuntime', desktopRuntime)"]],
    expect: ['HOST-002'],
  },
  {
    id: 'ignore-configured-index-url',
    note: 'the configured release index is dropped for the built-in default',
    edits: [['index.js',
      '  const releaseIndexEndpoint = resolveHTTPSURL(\n    config.releaseIndexURL,',
      '  const releaseIndexEndpoint = resolveHTTPSURL(\n    undefined,']],
    expect: ['HOST-003'],
  },
  {
    id: 'adapter-snapshot',
    scope: 'fixture',
    note: 'the native side stops reporting a packaged application',
    edits: [['test/host-contract/live-host.mjs',
      '      isPackaged: overrides.isPackaged ?? true,',
      '      isPackaged: overrides.isPackaged ?? false,']],
    expect: ['HOST-004'],
  },
  {
    id: 'release-user-agent',
    note: 'the product name stops reaching the release source',
    edits: [['index.js',
      "      'User-Agent': options.userAgent ?? PRODUCT_NAME,",
      "      'User-Agent': 'mutated',"]],
    expect: ['HOST-005'],
  },
  {
    id: 'no-fallback-endpoint',
    note: 'the configured fallback endpoint is never tried',
    edits: [['index.js',
      '            fallbackEndpoint: releaseEndpoint,',
      '            fallbackEndpoint: undefined,']],
    expect: ['HOST-006'],
  },
  {
    id: 'tray-locale-latched',
    note: 'the tray latches English instead of reading the live bridge locale',
    edits: [['index.js',
      "          ? checking ? updateMessages(ctx.desktopRuntime.locale).checking : updateMessages(ctx.desktopRuntime.locale).check",
      "          ? checking ? updateMessages('en').checking : updateMessages('en').check"]],
    expect: ['HOST-007'],
  },
  {
    id: 'tray-order',
    note: 'the tray contribution claims a different position',
    edits: [['index.js', "      group: 'status',\n      order: 10,", "      group: 'status',\n      order: 11,"]],
    expect: ['HOST-008'],
  },
  {
    id: 'manual-check-refetches',
    note: 'a second tray click re-queries the release source',
    edits: [['index.js',
      '        if (availableVersion !== undefined) {\n          await offerDownload(availableVersion, false)\n          return\n        }',
      '        if (false) {\n          await offerDownload(availableVersion, false)\n          return\n        }']],
    expect: ['HOST-009'],
  },
  {
    id: 'no-manual-result-dialog',
    note: 'the outcome of a manual check is never reported to the adapter',
    edits: [['index.js',
      '      if (electron === null) return adapter.showManualCheckResult(result)',
      '      if (electron === null) return undefined']],
    expect: ['HOST-010', 'HOST-020'],
  },
  {
    id: 'route-path',
    note: 'the plugin registers the Desktop update route at another path',
    edits: [['index.js',
      "export const DESKTOP_UPDATE_CHECK_PATH = '/api/desktop/updates/check'",
      "export const DESKTOP_UPDATE_CHECK_PATH = '/api/desktop/updates/check-mutated'"]],
    expect: ['HOST-011', 'HOST-012', 'HOST-017'],
  },
  {
    id: 'route-origin-fence',
    note: 'the route stops checking the origin against the bound port',
    edits: [['index.js',
      '  if (!isSameOriginLoopbackRequest(req, expectedOrigin)) {',
      '  if (false) {']],
    expect: ['HOST-012'],
  },
  {
    id: 'rpc-channel',
    note: 'the host half listens on a channel the browser half does not call',
    edits: [['index.js',
      "const UPDATE_RPC_CHANNEL = '/tokens-version-updates'",
      "const UPDATE_RPC_CHANNEL = '/tokens-version-updates-mutated'"]],
    // Five cases speak on this channel: the two endpoints, the fence that
    // guards it, the withdrawal check, and the handoff HOST-019 drives on it.
    expect: ['HOST-013', 'HOST-014', 'HOST-015', 'HOST-017', 'HOST-019'],
  },
  {
    id: 'rpc-download-endpoint',
    note: 'the download endpoint stops answering',
    edits: [['index.js',
      "          if (endpoint === 'download') return rpcSuccess({ started: await requestClientDownload() })",
      "          if (endpoint === 'download') return rpcFailure('mutated')"]],
    // HOST-019 drives the installer handoff through this endpoint.
    expect: ['HOST-014', 'HOST-019'],
  },
  {
    id: 'forged-host-header',
    scope: 'fixture',
    note: 'the fixture stops forging the Host header, so the trust fence is never tested',
    edits: [['test/host-contract/live-host.mjs',
      "  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) }",
      "  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) }\n"
      + '  delete headers.host']],
    expect: ['HOST-015'],
  },
  {
    id: 'state-path',
    note: 'the prompt state is written beside the path the adapter gave',
    edits: [['index.js',
      '        await writeFileAtomic(adapter.statePath, renderState(state), {',
      '        await writeFileAtomic(adapter.statePath + ".mutated", renderState(state), {']],
    expect: ['HOST-016'],
  },
  {
    id: 'dispose-leaks-route',
    note: 'disposal stops unregistering the route',
    edits: [['index.js', '      unregisterUpdateCheckRoute()\n', '      void unregisterUpdateCheckRoute\n']],
    expect: ['HOST-017'],
  },
  {
    id: 'peer-range',
    note: 'the declared dsh peer range is widened below the validated floor',
    edits: [['package.json',
      '"@deepseek-ai/dsh": ">=0.2.0-rc.2 <0.3.0-0"',
      '"@deepseek-ai/dsh": ">=0.1.0-rc.1 <0.3.0-0"']],
    expect: ['HOST-018'],
  },
  {
    id: 'installer-over-host-ipc',
    note: 'installer bytes are pushed through the text-only host update IPC',
    edits: [['index.js',
      '              // Host update requests are text-only IPC; installer bytes must stay local.\n              request: globalThis.fetch,',
      '              request: adapter.request,']],
    expect: ['HOST-019'],
  },
  {
    id: 'ignore-can-download',
    note: 'the plugin offers a download on a host that reports it cannot install one',
    edits: [['index.js',
      "      availableVersion = result.status === 'update-available' && adapter.canDownload",
      "      availableVersion = result.status === 'update-available'"]],
    expect: ['HOST-020'],
  },
  {
    id: 'client-slot-id',
    scope: 'client',
    note: 'the sidebar seat claims another list id',
    edits: [['dist/client.js', 'id: "tokens-version-updates"', 'id: "tokens-version-updates-mutated"']],
    expect: ['HOST-021'],
  },
  {
    id: 'client-primitive-name',
    scope: 'client',
    note: 'the client bundle goes back to the DSH 0.1 icon export name',
    edits: [['dist/client.js', 'IconDownloadOutlineRegular', 'IconDownloadOutline16']],
    expect: ['HOST-022'],
  },
  {
    id: 'client-rpc-endpoint',
    scope: 'client',
    note: 'the browser half calls an endpoint the host half does not serve',
    edits: [['dist/client.js', 'call("status")', 'call("statuz")']],
    expect: ['HOST-023'],
  },
]

/** Optional mutation ids on the command line; empty runs the whole matrix. */
const selected = new Set(process.argv.slice(2))

const hostRoot = process.env.DSH_HOST_ROOT
if (!hostRoot) {
  console.error('DSH_HOST_ROOT is required (the staged host\'s dsh-plugin-desktop directory)')
  process.exit(1)
}

/** Apply one mutation to a throwaway copy and report which cases went red. */
async function runMutation(mutation) {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'tokens-version-updates-mutation-'))
  /** Fixture files edited in place; restored before this function returns. */
  const restore = []
  try {
    for (const entry of COPIED) {
      const source = path.join(repositoryRoot, entry)
      if (existsSync(source)) cpSync(source, path.join(sandbox, entry), { recursive: true })
    }
    for (const [file, from, to, mode] of mutation.edits) {
      // A `test/` edit breaks the fixture itself, which has to be the real one
      // the runner imports; it is restored in the `finally` below.
      const inFixture = file.startsWith('test/')
      const target = path.join(inFixture ? repositoryRoot : sandbox, file)
      const before = readFileSync(target, 'utf8')
      // These files are checked out with CRLF on Windows; the needles are written
      // with plain newlines, so match against the file's own line ending.
      const eol = before.includes('\r\n') ? '\r\n' : '\n'
      const needle = from.replaceAll('\n', eol)
      const replacement = to.replaceAll('\n', eol)
      if (!before.includes(needle)) {
        return { noMatch: `${mutation.id}: no match in ${file} for\n${from}` }
      }
      if (inFixture && !restore.some(([existing]) => existing === target)) restore.push([target, before])
      writeFileSync(target, mode === 'all'
        ? before.replaceAll(needle, replacement)
        : before.replace(needle, replacement))
    }

    const names = mutation.scope === 'client'
      ? `^(${CLIENT_CASES.join('|')}) `
      : '^HOST-0(0[0-9]|1[0-9]|20) '
    const child = spawn(process.execPath, [
      '--test-concurrency=1', `--test-name-pattern=${names}`, runner, '--case-worker=host-contract',
    ], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        TOKENS_HOST_ROOT: hostRoot,
        TOKENS_PLUGIN_ROOT: sandbox,
        DSH_HOME: path.join(tmpdir(), 'tokens-version-updates-dsh-home-guard'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    // A broken path can leave a case waiting on something that never happens;
    // the suite's own timeouts bound that, this bounds the suite.
    const guard = setTimeout(() => child.kill(), 3 * 60 * 1000)
    await new Promise(resolve => child.once('close', resolve))
    clearTimeout(guard)
    // Reporter-independent: Node picks `tap` or `spec` depending on its
    // version and on whether stdout is a terminal (T0050).
    const summary = summariseCaseReport(output)
    return { red: [...summary.failed].sort(), green: [...summary.passed].sort(), output }
  } finally {
    for (const [target, before] of restore) writeFileSync(target, before)
    rmSync(sandbox, { recursive: true, force: true })
  }
}

const chosen = selected.size === 0
  ? MUTATIONS
  : MUTATIONS.filter(mutation => selected.has(mutation.id))
if (chosen.length === 0) {
  console.error(`no mutation matches ${[...selected].join(', ')}`)
  process.exit(1)
}

let failures = 0
for (const mutation of chosen) {
  const { red, green, output, noMatch } = await runMutation(mutation)
  if (noMatch !== undefined) {
    failures += 1
    console.error(`✗ ${noMatch}`)
    continue
  }
  const expected = [...mutation.expect].sort()
  const same = red.length === expected.length && red.every((id, index) => id === expected[index])
  if (green.length === 0 && red.length === 0) {
    failures += 1
    console.error(`✗ ${mutation.id}: no case ran at all\n${output.slice(-2000)}`)
    continue
  }
  if (same) {
    console.log(`✓ ${mutation.id} — ${mutation.note}; red: ${red.join(', ')}`)
    continue
  }
  failures += 1
  console.error(`✗ ${mutation.id} — ${mutation.note}`)
  console.error(`    expected red: ${expected.join(', ') || '(none)'}`)
  console.error(`    observed red: ${red.join(', ') || '(none)'}`)
}

console.log(failures === 0
  ? `\n变异验证通过：${chosen.length} 个变异各自恰好让预期用例变红`
  : `\n变异验证未通过：${failures}/${chosen.length}`)
process.exit(failures === 0 ? 0 : 1)
