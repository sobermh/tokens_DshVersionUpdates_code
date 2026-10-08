import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import test from 'node:test'
import {
  Config,
  DESKTOP_UPDATE_CHECK_PATH,
  MAX_VERSION_RESPONSE_BYTES,
  RELEASE_ENDPOINT,
  RELEASE_INDEX_ENDPOINT,
  apply,
  checkForStableUpdate,
  compareSemVerVersions,
  describeManualCheck,
  parseSemVer,
  productDataDirectory,
  resolveDownloadDirectory,
} from '../index.js'
import {
  MAX_INSTALLER_BYTES,
  downloadInstaller,
  openInstaller,
  selectInstallerAsset,
  verifyDownloadedInstaller,
} from '../download.js'
import { run } from 'node:test'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseDocument } from 'yaml'
import * as tar from 'tar'
import { validateRelease, RELEASE_REPOSITORY } from '../scripts/validate-release.mjs'
import { registryRelease } from '../scripts/registry-release.mjs'
import { verifyTarball } from '../scripts/verify-tarball.mjs'

export const TEST_UPSTREAM = {
  "repository": "anywhere-labs/deepseek-harness-desktop",
  "commit": "63e160ab4387988db894adef766865eab897cf80"
}

// Each suite runs in its own Node test process so OS/network mocks remain isolated.
const worker = process.argv[2]?.match(/^--case-worker=(comprehensive|plugin|publishing)$/)?.[1]
if (worker) {
  const register = { comprehensive: registerComprehensiveTests, plugin: registerPluginTests, publishing: registerPublishingTests }
  await register[worker]()
} else if (process.argv.length === 3 && process.argv[2] === '--upstream') {
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(TEST_UPSTREAM.repository) || !/^[a-f0-9]{40}$/.test(TEST_UPSTREAM.commit)) throw new Error('Invalid upstream source pin')
  console.log('repository=' + TEST_UPSTREAM.repository)
  console.log('commit=' + TEST_UPSTREAM.commit)
} else {
  await executeCases()
}

async function executeCases() {
const testDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = dirname(testDirectory)
const testFiles = ['run-test-cases.mjs']
if (process.argv.length !== 2) throw new Error('usage: node test/run-test-cases.mjs')

const cases = parseCSV(readFileSync(join(testDirectory, 'test_cases.csv'), 'utf8'))
const seen = new Set()
const mappedTests = new Set()
for (const item of cases) {
  const id = item['用例编号']
  if (!id || seen.has(id)) throw new Error('Missing or duplicate case ID: ' + id)
  seen.add(id)
  if (item['自动化状态'] !== '已自动化') throw new Error(id + ': this suite requires code-driven cases')
  item.references = item['对应测试'].split(/\r?\n|\s+\|\s+/u).filter(Boolean)
  if (!item.references.length) throw new Error(id + ': missing test mapping')
  for (const reference of item.references) {
    const [file, name] = reference.split(' :: ')
    if (!testFiles.some(value => file === 'test/' + value) || !name) {
      throw new Error(id + ': invalid test mapping ' + reference)
    }
    mappedTests.add(reference)
  }
}

// Use test-runner events: a named but skipped test is not a passed case.
const results = new Map()
let failedTests = 0
let passedTests = 0
let skippedTests = 0
for (const suite of ['comprehensive', 'plugin', 'publishing']) {
for await (const event of run({ files: [fileURLToPath(import.meta.url)], argv: ['--case-worker=' + suite], isolation: 'process' })) {
  if (!['test:pass', 'test:fail'].includes(event.type)) continue
  const data = event.data
  const file = data.file ? relative(repositoryRoot, resolve(data.file)).replaceAll('\\', '/') : ''
  const key = file + ' :: ' + data.name
  const skipped = Boolean(data.skip || data.todo)
  const passed = event.type === 'test:pass' && !skipped
  const reason = skipped ? 'Skipped/TODO: ' + (data.skip || data.todo)
    : passed ? '' : String(data.details?.error?.cause?.stack ?? data.details?.error?.message ?? 'test failed')
  results.set(key, { passed, reason })
  if (skipped) skippedTests++
  else if (passed) passedTests++
  else {
    failedTests++
    console.error('FAIL ' + key + '\n' + reason)
  }
}

}

let passedCases = 0
const failures = []
const unmappedTests = [...results.keys()].filter(key => !mappedTests.has(key))
for (const key of unmappedTests) console.error('Missing CSV case mapping: ' + key)
for (const item of cases) {
  const reasons = item.references.flatMap(reference => {
    const result = results.get(reference)
    return result?.passed ? [] : [reference + ': ' + (result?.reason ?? 'not executed')]
  })
  if (reasons.length) failures.push({ id: item['用例编号'], reasons })
  else passedCases++
}
console.log('\n功能回归结果：' + passedCases + '/' + cases.length + ' 条通过')
for (const failure of failures) console.error(failure.id + '\n' + failure.reasons.join('\n'))
console.log('总体结果：' + (failures.length || failedTests || unmappedTests.length ? '未通过' : '全部通过'))
process.exitCode = failures.length || failedTests || unmappedTests.length ? 1 : 0

function parseCSV(source) {
  source = source.replace(/^\uFEFF/u, '')
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field.replace(/\r$/u, ''))
      rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field')
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  const [headers, ...records] = rows
  const expectedHeaders = ['用例编号', '所属模块', '用例标题', '前置条件', '测试数据', '操作步骤', '预期结果', '优先级', '自动化状态', '对应测试']
  if (!headers || headers.length !== expectedHeaders.length || headers.some((value, index) => value !== expectedHeaders[index])) {
    throw new Error('CSV must use the fixed ten-column header')
  }
  return records
    .filter(record => record.some(value => value !== ''))
    .map((record, index) => {
      if (record.length !== headers.length) throw new Error('CSV record ' + (index + 2) + ' must contain ten columns')
      return Object.fromEntries(headers.map((header, column) => [header, record[column]]))
    })
}

}

// Comprehensive assertions; CSV maps observable cases to these test names.
async function registerComprehensiveTests() {
/** 全面正反用例：SemVer、Release 解析、资产选择、下载校验、插件生命周期。 */













/* Exercise the checked-out upstream bridge, not a copied compatibility mock. */
async function attachCurrentUpstream(host) {
  const { build } = await import('esbuild')
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  const candidates = [
    join(pluginRoot, '.test-host'),
    join(pluginRoot, '..', '..'),
    join(pluginRoot, '..', 'TokensCowork'),
    join(pluginRoot, '..', 'tokens_TokensHarness_code'),
  ]
  const outerRoot = process.env.TOKENS_HARNESS_ROOT
    ? resolve(process.env.TOKENS_HARNESS_ROOT)
    : candidates.find(root => existsSync(join(root, 'desktop', 'dsh-plugin-desktop', 'src', 'host-runtime-bridge.ts')))
  assert.ok(outerRoot, 'Current upstream source missing; set TOKENS_HARNESS_ROOT or checkout TEST_UPSTREAM into .test-host/desktop')
  const source = join(outerRoot, 'desktop', 'dsh-plugin-desktop', 'src')
  assert.ok(existsSync(join(source, 'host-runtime-bridge.ts')), 'Current upstream source missing; set TOKENS_HARNESS_ROOT')
  const built = await build({
    stdin: {
      contents: "export { createHostRuntime, bindNativeRuntime, runtimeSnapshot } from './host-runtime-bridge.ts'; export { HostRpc } from './host-rpc.ts'",
      resolveDir: source, loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', write: false,
  })
  const { createHostRuntime, bindNativeRuntime, runtimeSnapshot, HostRpc } =
    await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))
  const listeners = [undefined, undefined]
  const port = index => ({
    send(message) {
      const copy = structuredClone(message)
      queueMicrotask(() => listeners[1 - index]?.(copy))
    },
    listen(callback) { listeners[index] = callback; return () => { listeners[index] = undefined } },
  })
  const nativeRpc = new HostRpc(port(0), 2000)
  const hostRpc = new HostRpc(port(1), 2000)
  let tray
  const original = host.ctx.desktopRuntime
  const native = {
    ...original, platform: process.platform, locale: 'en',
    registerTrayItem(item) {
      tray = item
      return original.registerTrayItem(item)
    },
  }
  const unbind = bindNativeRuntime(nativeRpc, native)
  const remote = createHostRuntime(hostRpc, runtimeSnapshot(native))
  host.ctx.desktopRuntime = remote
  return {
    remote,
    tray: () => tray,
    async close() {
      await unbind()
      hostRpc.close()
      nativeRpc.close()
    },
  }
}

async function upstreamDownloadRegression(t, failDownload) {
  const root = await tempDir('actual-upstream')
  const payload = Buffer.from([0x4d, 0x5a, 0xff, 0xfe, 0, 0x80, 0xc3, 0x28])
  const asset = downloadableRelease('0.2.0', payload)
  const url = 'https://github.com/o/r/releases/download/v0.2.0/' + asset.name
  let binaryRequests = 0
  const host = harness({
    root, connection: true,
    request: async (target, init) => {
      assert.ok(isReleaseMetadataRequest(target), 'Installer must not cross the text-only upstream bridge')
      assert.equal(init.redirect, 'error')
      assert.equal(init.cache, 'no-store')
      assert.ok(init.signal instanceof AbortSignal)
      return release({ assets: [{ ...asset, browser_download_url: url }] })
    },
    downloadRequest: async target => {
      assert.equal(target, url)
      binaryRequests++
      return failDownload ? new Response('unavailable', { status: 503 }) : new Response(payload)
    },
  })
  const bridge = await attachCurrentUpstream(host)
  mockInstallerLaunch(t)
  const instance = host.start()
  try {
    await bridge.remote.mountScheduled()
    assert.ok(bridge.tray(), 'Upstream tray registration must complete')
    await bridge.tray().invoke()
    assert.deepEqual(await instance.rpc('status'), {
      ok: true, value: { phase: 'available', productName: 'TokensHarness', version: '0.2.0' },
    })
    assert.deepEqual(host.log.confirmed, ['0.2.0'])
    assert.deepEqual(await instance.rpc('download'), { ok: true, value: { started: !failDownload } })
    assert.equal(binaryRequests, 1)
    const path = join(root, '0.2.0', asset.name)
    if (failDownload) assert.equal(existsSync(path), false)
    else assert.deepEqual(await readFile(path), payload)
  } finally {
    await instance.dispose()
    await bridge.close()
    await rm(root, { recursive: true, force: true })
  }
}

test('176 current upstream bridge preserves plugin binary downloads', async t => {
  await upstreamDownloadRegression(t, false)
})

test('177 current upstream bridge reports download failure accurately', async t => {
  await upstreamDownloadRegression(t, true)
})

test('178 current upstream bridge propagates cancellation', async () => {
  const root = await tempDir('upstream-cancel')
  let signal
  let started
  const ready = new Promise(resolve => { started = resolve })
  const host = harness({
    root,
    request: async (_url, init) => {
      signal = init.signal
      started()
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
    },
  })
  const bridge = await attachCurrentUpstream(host)
  const controller = new AbortController()
  try {
    const pending = bridge.remote.updates.request('https://example.test/releases', { signal: controller.signal })
    await ready
    controller.abort()
    await assert.rejects(pending, /cancel/i)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(signal.aborted, true)
  } finally {
    await bridge.close()
    await rm(root, { recursive: true, force: true })
  }
})





/* ============================ 测试夹具 ============================ */

function release(overrides = {}) {
  return Response.json({ tag_name: 'v0.2.0', draft: false, prerelease: false, assets: [], ...overrides })
}

/** 轮询等待状态文件被后台修复：stateReady 是异步的，且拆卸期会刻意跳过写盘。 */
async function waitForState(path, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await readFile(path, 'utf8')
      if (predicate(last)) return last
    } catch (cause) {
      // ENOENT：尚未写入；EPERM/EBUSY：Windows 上原子写改名与本轮询读句柄相撞，重试即可。
      if (!['ENOENT', 'EPERM', 'EBUSY'].includes(cause?.code)) throw cause
      last = undefined
    }
    await new Promise(resolve => { setTimeout(resolve, 25) })
  }
  throw new Error(`state file never settled; last content: ${String(last)}`)
}

async function tempDir(tag) {
  return mkdtemp(join(tmpdir(), `dvu-${tag}-`))
}

function desktopUpdateRequest(value = {}, options = {}) {
  const body = typeof value === 'string' ? value : JSON.stringify(value)
  const req = Readable.from([body])
  req.method = options.method ?? 'POST'
  req.headers = {
    host: '127.0.0.1:43120',
    origin: 'http://127.0.0.1:43120',
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
    ...options.headers,
  }
  Object.defineProperty(req, 'socket', {
    value: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
  })
  return req
}

function desktopUpdateResponse() {
  const headers = new Map()
  return {
    statusCode: 0,
    body: '',
    headers,
    setHeader(name, value) { headers.set(name.toLowerCase(), String(value)) },
    end(value = '') { this.body = String(value) },
  }
}

/**
 * 构造一个可观测的 desktopRuntime 宿主，捕获托盘项与 effect 卸载器。
 */
function harness(options = {}) {
  const log = { manual: [], confirmed: [], requests: [] }
  let tray
  let rpcHandler
  let updateRoute
  const disposers = []
  const registration = {
    refreshCount: 0,
    refresh() { registration.refreshCount += 1 },
    disposed: false,
    dispose() { registration.disposed = true },
  }
  const adapter = {
    isPackaged: false,
    canDownload: true,
    currentVersion: '0.1.0',
    statePath: join(options.root, 'state.json'),
    request: async (url, init) => {
      log.requests.push({ url, init })
      return (options.request ?? (async () => release()))(url, init)
    },
    async confirmDownload(version) {
      log.confirmed.push(version)
      return options.confirm ?? false
    },
    async showManualCheckResult(result) { log.manual.push(result) },
    async downloadAndOpen() {},
    ...options.adapter,
  }
  const ctx = {
    desktopRuntime: {
      updates: adapter,
      registerTrayItem(item) { tray = item; return registration },
    },
    webServer: {
      port: 43120,
      register(route) {
        updateRoute = route
        return () => { updateRoute = undefined }
      },
    },
    effect(register) {
      const disposer = register()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
    inject(_services, apply) {
      if (!options.connection) return
      apply({
        ...ctx,
        connection: {
          rpc: {
            handle(_channel, handler) {
              rpcHandler = handler
              return () => { rpcHandler = undefined }
            },
          },
        },
      })
    },
  }
  return {
    ctx,
    log,
    registration,
    adapter,
    start(config = {}) {
      const originalFetch = globalThis.fetch
      globalThis.fetch = options.downloadRequest ?? adapter.request
      // 默认下载目录钉在本次临时目录：真实默认位置在应用数据目录下，
      // 测试绝不能往那里写。关心默认位置的用例自行覆盖这个字段。
      apply(ctx, Config({ enabled: false, downloadDirectory: options.root, ...config }))
      return {
        tray,
        updateRoute: () => updateRoute,
        rpc: async (endpoint, payload = {}) => {
          assert.notEqual(rpcHandler, undefined, 'RPC channel must be registered')
          return rpcHandler(endpoint, payload)
        },
        dispose: async () => {
          globalThis.fetch = originalFetch
          for (const disposer of disposers.reverse()) await disposer()
        },
      }
    },
  }
}

/* ==================== 1. SemVer 解析：正例 ==================== */

test('installer bytes bypass the text-only Host bridge', { skip: !['win32', 'darwin'].includes(process.platform) }, async (t) => {
  mockInstallerLaunch(t)
  const root = await tempDir('binary-bridge')
  const payload = Buffer.from([0x4d, 0x5a, 0x90, 0xff, 0, 0xfe])
  const asset = downloadableRelease('0.2.0', payload)
  let downloads = 0
  const host = harness({
    root, connection: true,
    request: async (url) => {
      assert.ok(isReleaseMetadataRequest(url), 'binary requests must not reach Host IPC')
      return release({ assets: [{ ...asset, browser_download_url: `https://github.com/o/r/${asset.name}` }] })
    },
    downloadRequest: async () => {
      downloads += 1
      return new Response(payload)
    },
  })
  const { tray, rpc, dispose } = host.start()
  try {
    await tray.invoke()
    assert.deepEqual(await rpc('download'), { ok: true, value: { started: true } })
    assert.equal(downloads, 1)
    assert.deepEqual(await readFile(join(root, '0.2.0', asset.name)), payload)
  } finally {
    await dispose()
    await rm(root, { recursive: true, force: true })
  }
})

function mockInstallerLaunch(t) {
  t.mock.method(childProcess, 'spawn', () => ({ once(event, callback) { if (event === 'spawn') queueMicrotask(callback) }, unref() {} }))
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
}

test('failed binary request does not report started true', { skip: !['win32', 'darwin'].includes(process.platform) }, async () => {
  const root = await tempDir('binary-failure')
  const asset = downloadableRelease('0.2.0', Buffer.from('bytes'))
  const host = harness({
    root, connection: true,
    request: async () => release({ assets: [{ ...asset, browser_download_url: `https://github.com/o/r/${asset.name}` }] }),
    downloadRequest: async () => { throw new Error('offline') },
  })
  const { tray, rpc, dispose } = host.start()
  try {
    await tray.invoke()
    assert.deepEqual(await rpc('download'), { ok: true, value: { started: false } })
  } finally {
    await dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('01 parseSemVer accepts a plain stable version', () => {
  assert.deepEqual(parseSemVer('1.2.3'), {
    version: '1.2.3', major: '1', minor: '2', patch: '3', prerelease: [], build: [],
  })
})

test('02 parseSemVer strips a leading v prefix', () => {
  assert.equal(parseSemVer('v10.20.30')?.version, '10.20.30')
})

test('03 parseSemVer accepts all-zero version', () => {
  assert.equal(parseSemVer('0.0.0')?.version, '0.0.0')
})

test('04 parseSemVer keeps prerelease identifiers in order', () => {
  assert.deepEqual(parseSemVer('1.0.0-alpha.1')?.prerelease, ['alpha', '1'])
})

test('05 parseSemVer keeps build metadata separate from prerelease', () => {
  const parsed = parseSemVer('1.0.0-beta+exp.sha.5114f85')
  assert.deepEqual(parsed?.prerelease, ['beta'])
  assert.deepEqual(parsed?.build, ['exp', 'sha', '5114f85'])
})

test('06 parseSemVer accepts very large numeric segments without overflow', () => {
  assert.equal(parseSemVer('99999999999999999999.0.0')?.major, '99999999999999999999')
})

test('07 parseSemVer accepts a hyphenated prerelease identifier', () => {
  assert.deepEqual(parseSemVer('1.0.0-x-y-z.1')?.prerelease, ['x-y-z', '1'])
})

/* ==================== 2. SemVer 解析：反例 ==================== */

test('08 parseSemVer rejects a two-segment version', () => {
  assert.equal(parseSemVer('0.1'), null)
})

test('09 parseSemVer rejects a four-segment version', () => {
  assert.equal(parseSemVer('1.2.3.4'), null)
})

test('10 parseSemVer rejects leading zeros in the major segment', () => {
  assert.equal(parseSemVer('01.2.3'), null)
})

test('11 parseSemVer rejects leading zeros in a numeric prerelease identifier', () => {
  assert.equal(parseSemVer('1.0.0-01'), null)
})

test('12 parseSemVer rejects an empty string', () => {
  assert.equal(parseSemVer(''), null)
})

test('13 parseSemVer rejects an uppercase V prefix', () => {
  assert.equal(parseSemVer('V1.2.3'), null)
})

test('14 parseSemVer rejects surrounding whitespace', () => {
  assert.equal(parseSemVer(' 1.2.3 '), null)
})

test('15 parseSemVer rejects a negative segment', () => {
  assert.equal(parseSemVer('1.-2.3'), null)
})

test('16 parseSemVer rejects an empty prerelease after the hyphen', () => {
  assert.equal(parseSemVer('1.0.0-'), null)
})

test('17 parseSemVer rejects non-alphanumeric prerelease characters', () => {
  assert.equal(parseSemVer('1.0.0-al_pha'), null)
})

/* ==================== 3. SemVer 比较 ==================== */

test('18 compareSemVerVersions orders by major segment', () => {
  assert.equal(compareSemVerVersions('2.0.0', '1.9.9'), 1)
})

test('19 compareSemVerVersions orders by minor segment', () => {
  assert.equal(compareSemVerVersions('1.2.0', '1.10.0'), -1)
})

test('20 compareSemVerVersions orders by patch segment', () => {
  assert.equal(compareSemVerVersions('1.0.2', '1.0.10'), -1)
})

test('21 compareSemVerVersions reports equality', () => {
  assert.equal(compareSemVerVersions('1.2.3', '1.2.3'), 0)
})

test('22 compareSemVerVersions ranks a prerelease below its stable release', () => {
  assert.equal(compareSemVerVersions('1.0.0-alpha', '1.0.0'), -1)
  assert.equal(compareSemVerVersions('1.0.0', '1.0.0-alpha'), 1)
})

test('23 compareSemVerVersions ranks numeric prerelease below alphanumeric', () => {
  assert.equal(compareSemVerVersions('1.0.0-1', '1.0.0-alpha'), -1)
})

test('24 compareSemVerVersions orders numeric prerelease identifiers numerically', () => {
  assert.equal(compareSemVerVersions('1.0.0-2', '1.0.0-10'), -1)
})

test('25 compareSemVerVersions ranks a shorter prerelease prefix lower', () => {
  assert.equal(compareSemVerVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1)
})

test('26 compareSemVerVersions ignores build metadata', () => {
  assert.equal(compareSemVerVersions('1.0.0+a', '1.0.0+b'), 0)
})

test('27 compareSemVerVersions compares huge segments without precision loss', () => {
  assert.equal(compareSemVerVersions('9007199254740993.0.0', '9007199254740992.0.0'), 1)
})

test('28 compareSemVerVersions returns null when either side is invalid', () => {
  assert.equal(compareSemVerVersions('bad', '1.0.0'), null)
  assert.equal(compareSemVerVersions('1.0.0', 'bad'), null)
})

/* ==================== 4. Release 响应校验：正例 ==================== */

test('29 checkForStableUpdate reports an available newer release', async () => {
  const result = await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => release({ tag_name: 'v0.2.0' }),
  })
  assert.equal(result?.status, 'update-available')
  assert.equal(result?.latestVersion, '0.2.0')
})

test('30 checkForStableUpdate reports up-to-date on an equal release', async () => {
  const result = await checkForStableUpdate({
    currentVersion: '1.0.0',
    request: async () => release({ tag_name: 'v1.0.0' }),
  })
  assert.equal(result?.status, 'up-to-date')
})

test('31 checkForStableUpdate reports up-to-date when the release is older', async () => {
  const result = await checkForStableUpdate({
    currentVersion: '2.0.0',
    request: async () => release({ tag_name: 'v1.0.0' }),
  })
  assert.equal(result?.status, 'up-to-date')
})

test('32 checkForStableUpdate sends the documented GitHub API headers', async () => {
  let seen
  await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async (_url, init) => { seen = new Headers(init.headers); return release() },
  })
  assert.equal(seen.get('accept'), 'application/vnd.github+json')
  assert.equal(seen.get('x-github-api-version'), '2022-11-28')
})

test('33 checkForStableUpdate refuses to follow redirects and skips the cache', async () => {
  let init
  await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async (_url, value) => { init = value; return release() },
  })
  assert.equal(init.redirect, 'error')
  assert.equal(init.cache, 'no-store')
})

test('34 checkForStableUpdate honours a custom endpoint and user agent', async () => {
  let url, agent
  await checkForStableUpdate({
    currentVersion: '0.1.0',
    endpoint: 'https://example.test/latest',
    userAgent: 'Custom/1.0',
    request: async (value, init) => {
      url = value; agent = new Headers(init.headers).get('user-agent')
      return release()
    },
  })
  assert.equal(url, 'https://example.test/latest')
  assert.equal(agent, 'Custom/1.0')
})

test('35 checkForStableUpdate normalises well-formed release assets', async () => {
  const digest = `sha256:${'a'.repeat(64)}`
  const result = await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => release({
      assets: [{
        name: 'TokensHarness-0.2.0-windows-amd64-installer.exe',
        browser_download_url: 'https://github.com/o/r/releases/download/v0.2.0/a.exe',
        size: 4096,
        digest,
      }],
    }),
  })
  assert.deepEqual(result?.assets, [{
    name: 'TokensHarness-0.2.0-windows-amd64-installer.exe',
    url: 'https://github.com/o/r/releases/download/v0.2.0/a.exe',
    size: 4096,
    digest,
  }])
})

test('36 checkForStableUpdate defaults missing asset size and digest', async () => {
  const result = await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => release({
      assets: [{ name: 'a.exe', browser_download_url: 'https://github.com/a.exe' }],
    }),
  })
  assert.equal(result?.assets[0].size, 0)
  assert.equal(result?.assets[0].digest, null)
})

test('37 checkForStableUpdate forwards the caller abort signal', async () => {
  const controller = new AbortController()
  let forwarded
  await checkForStableUpdate({
    currentVersion: '0.1.0',
    signal: controller.signal,
    request: async (_url, init) => { forwarded = init.signal; return release() },
  })
  assert.equal(forwarded, controller.signal)
})

/* ==================== 5. Release 响应校验：反例 ==================== */

test('38 checkForStableUpdate rejects a non-canonical current version', async () => {
  let called = false
  const result = await checkForStableUpdate({
    currentVersion: 'v0.1.0',
    request: async () => { called = true; return release() },
  })
  assert.equal(result, null)
  assert.equal(called, false, 'must not spend a request on an invalid current version')
})

test('39 checkForStableUpdate rejects a prerelease current version', async () => {
  assert.equal(await checkForStableUpdate({
    currentVersion: '1.0.0-rc.1',
    request: async () => release(),
  }), null)
})

test('40 checkForStableUpdate returns null on a non-200 status', async () => {
  for (const status of [301, 403, 404, 429, 500]) {
    assert.equal(await checkForStableUpdate({
      currentVersion: '0.1.0',
      request: async () => new Response('{}', { status }),
    }), null, `status ${String(status)} must not yield a result`)
  }
})

test('41 checkForStableUpdate returns null when the request throws', async () => {
  assert.equal(await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => { throw new Error('network down') },
  }), null)
})

test('42 checkForStableUpdate returns null on malformed JSON', async () => {
  assert.equal(await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => new Response('{not json', { status: 200 }),
  }), null)
})

test('43 checkForStableUpdate rejects a draft release', async () => {
  assert.equal(await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => release({ draft: true }),
  }), null)
})

test('44 checkForStableUpdate rejects a prerelease release', async () => {
  assert.equal(await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => release({ prerelease: true }),
  }), null)
})

test('45 checkForStableUpdate rejects a tag without the v prefix', async () => {
  assert.equal(await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => release({ tag_name: '0.2.0' }),
  }), null)
})

test('46 checkForStableUpdate rejects a prerelease tag on a stable release', async () => {
  assert.equal(await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => release({ tag_name: 'v0.2.0-rc.1' }),
  }), null)
})

test('47 checkForStableUpdate rejects a missing draft or prerelease flag', async () => {
  assert.equal(await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => Response.json({ tag_name: 'v0.2.0', prerelease: false }),
  }), null)
  assert.equal(await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => Response.json({ tag_name: 'v0.2.0', draft: false }),
  }), null)
})

test('48 checkForStableUpdate rejects an index without a stable release', async () => {
  assert.equal(await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => new Response('[]', { status: 200 }),
  }), null)
})

test('49 checkForStableUpdate rejects an over-declared content-length', async () => {
  assert.equal(await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => new Response('{}', {
      status: 200,
      headers: { 'content-length': String(MAX_VERSION_RESPONSE_BYTES + 1) },
    }),
  }), null)
})

test('50 checkForStableUpdate rejects a body exceeding the byte cap while streaming', async () => {
  const oversized = 'x'.repeat(MAX_VERSION_RESPONSE_BYTES + 16)
  assert.equal(await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(oversized))
        controller.close()
      },
    }), { status: 200 }),
  }), null)
})

test('51 checkForStableUpdate rejects invalid UTF-8 in the response body', async () => {
  assert.equal(await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => new Response(Uint8Array.from([0xff, 0xfe, 0xfd]), { status: 200 }),
  }), null)
})

test('52 checkForStableUpdate drops assets with a non-HTTPS download URL', async () => {
  const result = await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => release({
      assets: [
        { name: 'evil.exe', browser_download_url: 'http://github.com/evil.exe' },
        { name: 'ok.exe', browser_download_url: 'https://github.com/ok.exe' },
      ],
    }),
  })
  assert.deepEqual(result?.assets.map(asset => asset.name), ['ok.exe'])
})

test('53 checkForStableUpdate drops structurally invalid assets', async () => {
  const result = await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => release({
      assets: [null, 'string', { name: 1, browser_download_url: 'https://a' }, { name: 'x' }],
    }),
  })
  assert.deepEqual(result?.assets, [])
})

test('54 checkForStableUpdate tolerates a non-array assets field', async () => {
  const result = await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async () => release({ assets: { nope: true } }),
  })
  assert.deepEqual(result?.assets, [])
})

/* ==================== 6. 资产选择 ==================== */

const INSTALLERS = [
  { name: 'TokensHarness-0.2.0-windows-amd64-installer.exe', url: 'https://github.com/w', size: 1, digest: null },
  { name: 'TokensHarness-0.2.0-macos-arm64-installer.dmg', url: 'https://github.com/m', size: 1, digest: null },
  { name: 'TokensHarness-0.2.0-macos-amd64-installer.dmg', url: 'https://github.com/i', size: 1, digest: null },
  { name: 'TokensHarness-0.2.0-SHA256SUMS.txt', url: 'https://github.com/s', size: 1, digest: null },
]

test('55 selectInstallerAsset picks the Windows x64 installer', () => {
  assert.equal(selectInstallerAsset(INSTALLERS, 'win32', 'x64')?.name, INSTALLERS[0].name)
})

test('56 selectInstallerAsset picks the macOS arm64 installer', () => {
  assert.equal(selectInstallerAsset(INSTALLERS, 'darwin', 'arm64')?.name, INSTALLERS[1].name)
})

test('57 selectInstallerAsset picks the macOS x64 installer', () => {
  assert.equal(selectInstallerAsset(INSTALLERS, 'darwin', 'x64')?.name, INSTALLERS[2].name)
})

test('58 selectInstallerAsset returns null for an unsupported platform', () => {
  assert.equal(selectInstallerAsset(INSTALLERS, 'linux', 'x64'), null)
  assert.equal(selectInstallerAsset(INSTALLERS, 'freebsd', 'arm64'), null)
})

test('59 selectInstallerAsset returns null for an unsupported architecture', () => {
  assert.equal(selectInstallerAsset(INSTALLERS, 'win32', 'arm64'), null)
  assert.equal(selectInstallerAsset(INSTALLERS, 'win32', 'ia32'), null)
})

test('60 selectInstallerAsset returns null when no asset matches the pattern', () => {
  assert.equal(selectInstallerAsset([INSTALLERS[3]], 'win32', 'x64'), null)
})

test('61 selectInstallerAsset returns null for an empty asset list', () => {
  assert.equal(selectInstallerAsset([], 'win32', 'x64'), null)
})

test('62 selectInstallerAsset anchors the suffix and rejects lookalike names', () => {
  const decoys = [
    { name: 'TokensHarness-windows-amd64-installer.exe.txt', url: 'https://github.com/a', size: 1, digest: null },
    { name: 'windows-amd64-installer.exe.bak', url: 'https://github.com/b', size: 1, digest: null },
  ]
  assert.equal(selectInstallerAsset(decoys, 'win32', 'x64'), null)
})

test('63 selectInstallerAsset does not cross-match macOS assets on Windows', () => {
  assert.equal(selectInstallerAsset([INSTALLERS[1], INSTALLERS[2]], 'win32', 'x64'), null)
})

/* ==================== 7. 下载与摘要校验：正例 ==================== */

test('64 downloadInstaller writes a payload whose digest matches', async () => {
  const root = await tempDir('ok')
  try {
    const payload = Buffer.from('installer-payload')
    const digest = `sha256:${createHash('sha256').update(payload).digest('hex')}`
    const path = await downloadInstaller({
      asset: { name: 'ok.exe', url: 'https://github.com/x', size: payload.byteLength, digest },
      url: 'https://github.com/x',
      request: async () => new Response(payload),
      directory: root,
    })
    assert.equal(path, join(root, 'ok.exe'))
    assert.deepEqual(await readFile(path), payload)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('65 downloadInstaller accepts an asset without a declared digest', async () => {
  const root = await tempDir('nodigest')
  try {
    const path = await downloadInstaller({
      asset: { name: 'n.exe', url: 'https://github.com/x', size: 0, digest: null },
      url: 'https://github.com/x',
      request: async () => new Response(Buffer.from('bytes')),
      directory: root,
    })
    assert.deepEqual(await readFile(path), Buffer.from('bytes'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('66 downloadInstaller rejects a malformed digest string', async () => {
  const root = await tempDir('baddigest')
  try {
    await assert.rejects(downloadInstaller({
      asset: { name: 'b.exe', url: 'https://github.com/x', size: 5, digest: 'md5:abc' },
      url: 'https://github.com/x',
      request: async () => new Response(Buffer.from('bytes')),
      directory: root,
    }), /digest is invalid/u)
    assert.deepEqual(await readdir(root).catch(() => []), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('67 downloadInstaller reassembles a multi-chunk stream correctly', async () => {
  const root = await tempDir('chunks')
  try {
    const chunks = ['alpha', 'beta', 'gamma'].map(part => Buffer.from(part))
    const payload = Buffer.concat(chunks)
    const digest = `sha256:${createHash('sha256').update(payload).digest('hex')}`
    const path = await downloadInstaller({
      asset: { name: 'c.exe', url: 'https://github.com/x', size: payload.byteLength, digest },
      url: 'https://github.com/x',
      request: async () => new Response(new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk))
          controller.close()
        },
      })),
      directory: root,
    })
    assert.deepEqual(await readFile(path), payload)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('68 downloadInstaller overwrites a stale file at the destination', async () => {
  const root = await tempDir('overwrite')
  try {
    await writeFile(join(root, 'o.exe'), 'stale')
    const path = await downloadInstaller({
      asset: { name: 'o.exe', url: 'https://github.com/x', size: 5, digest: null },
      url: 'https://github.com/x',
      request: async () => new Response(Buffer.from('fresh')),
      directory: root,
    })
    assert.equal(await readFile(path, 'utf8'), 'fresh')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('69 downloadInstaller creates the destination directory when absent', async () => {
  const root = await tempDir('mkdir')
  const nested = join(root, 'a', 'b')
  try {
    const path = await downloadInstaller({
      asset: { name: 'd.exe', url: 'https://github.com/x', size: 1, digest: null },
      url: 'https://github.com/x',
      request: async () => new Response(Buffer.from('z')),
      directory: nested,
    })
    assert.equal(path, join(nested, 'd.exe'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('70 downloadInstaller requests the URL it is given, not the asset URL', async () => {
  const root = await tempDir('mirror')
  try {
    let requested
    let requestedInit
    await downloadInstaller({
      asset: { name: 'm.exe', url: 'https://github.com/original', size: 1, digest: null },
      url: 'https://mirror.test/proxy',
      request: async (url, init) => {
        requested = url
        requestedInit = init
        return new Response(Buffer.from('z'))
      },
      directory: root,
    })
    assert.equal(requested, 'https://mirror.test/proxy')
    assert.equal(requestedInit.redirect, 'follow')
    assert.equal(requestedInit.cache, 'no-store')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ==================== 8. 下载与摘要校验：反例 ==================== */

test('71 downloadInstaller rejects a mismatched SHA-256 digest', async () => {
  const root = await tempDir('mismatch')
  try {
    await assert.rejects(downloadInstaller({
      asset: {
        name: 'x.exe', url: 'https://github.com/x', size: 100,
        digest: `sha256:${'0'.repeat(64)}`,
      },
      url: 'https://github.com/x',
      request: async () => new Response(Buffer.from('tampered')),
      directory: root,
    }), /digest mismatch/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('72 downloadInstaller leaves no file behind after a digest mismatch', async () => {
  const root = await tempDir('cleanup')
  try {
    await assert.rejects(downloadInstaller({
      asset: {
        name: 'y.exe', url: 'https://github.com/x', size: 100,
        digest: `sha256:${'0'.repeat(64)}`,
      },
      url: 'https://github.com/x',
      request: async () => new Response(Buffer.from('tampered')),
      directory: root,
    }))
    assert.deepEqual(await readdir(root), [], 'temporary and final files must both be gone')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('73 downloadInstaller rejects a non-200 response', async () => {
  const root = await tempDir('status')
  try {
    await assert.rejects(downloadInstaller({
      asset: { name: 's.exe', url: 'https://github.com/x', size: 1, digest: null },
      url: 'https://github.com/x',
      request: async () => new Response('nope', { status: 404 }),
      directory: root,
    }), /HTTP 404/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('74 downloadInstaller rejects an empty response body', async () => {
  const root = await tempDir('empty')
  try {
    await assert.rejects(downloadInstaller({
      asset: { name: 'e.exe', url: 'https://github.com/x', size: 1, digest: null },
      url: 'https://github.com/x',
      request: async () => new Response(new Uint8Array(0)),
      directory: root,
    }), /empty body/u)
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('75 downloadInstaller rejects a payload larger than the declared size', async () => {
  const root = await tempDir('oversize')
  try {
    await assert.rejects(downloadInstaller({
      asset: { name: 'o.exe', url: 'https://github.com/x', size: 4, digest: null },
      url: 'https://github.com/x',
      request: async () => new Response(Buffer.from('far too many bytes')),
      directory: root,
    }), /exceeds the declared size/u)
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('76 downloadInstaller caps a zero-declared size at the global installer limit', async () => {
  const root = await tempDir('cap')
  try {
    const path = await downloadInstaller({
      asset: { name: 'z.exe', url: 'https://github.com/x', size: 0, digest: null },
      url: 'https://github.com/x',
      request: async () => new Response(Buffer.alloc(64, 7)),
      directory: root,
    })
    assert.equal((await readFile(path)).byteLength, 64)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('77 downloadInstaller ignores an absurd declared size and applies the global limit', async () => {
  const root = await tempDir('absurd')
  try {
    const path = await downloadInstaller({
      asset: { name: 'a.exe', url: 'https://github.com/x', size: MAX_INSTALLER_BYTES + 1, digest: null },
      url: 'https://github.com/x',
      request: async () => new Response(Buffer.from('small')),
      directory: root,
    })
    assert.equal(await readFile(path, 'utf8'), 'small')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('78 downloadInstaller aborts when the caller signal fires', async () => {
  const root = await tempDir('abort')
  try {
    const controller = new AbortController()
    await assert.rejects(downloadInstaller({
      asset: { name: 'ab.exe', url: 'https://github.com/x', size: 1024, digest: null },
      url: 'https://github.com/x',
      request: async () => new Response(new ReadableStream({
        start(controllerStream) {
          controllerStream.enqueue(new Uint8Array(8))
          controller.abort()
          controllerStream.enqueue(new Uint8Array(8))
          controllerStream.close()
        },
      })),
      directory: root,
      signal: controller.signal,
    }))
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('79 downloadInstaller propagates a stream error and cleans up', async () => {
  const root = await tempDir('streamerr')
  try {
    await assert.rejects(downloadInstaller({
      asset: { name: 'se.exe', url: 'https://github.com/x', size: 100, digest: null },
      url: 'https://github.com/x',
      request: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(4))
          controller.error(new Error('connection reset'))
        },
      })),
      directory: root,
    }), /connection reset/u)
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('80 downloadInstaller propagates a request rejection', async () => {
  const root = await tempDir('reqerr')
  try {
    await assert.rejects(downloadInstaller({
      asset: { name: 'r.exe', url: 'https://github.com/x', size: 1, digest: null },
      url: 'https://github.com/x',
      request: async () => { throw new Error('dns failure') },
      directory: root,
    }), /dns failure/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('81 downloadInstaller accepts and verifies an uppercase-hex digest', async () => {
  const root = await tempDir('upperhex')
  try {
    const payload = Buffer.from('bytes')
    const digest = createHash('sha256').update(payload).digest('hex').toUpperCase()
    const path = await downloadInstaller({
      asset: { name: 'u.exe', url: 'https://github.com/x', size: 5, digest: `sha256:${digest}` },
      url: 'https://github.com/x',
      request: async () => new Response(payload),
      directory: root,
    })
    assert.ok(path.endsWith('u.exe'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('82 openInstaller rejects when the target cannot be executed', async () => {
  await assert.rejects(openInstaller(join(tmpdir(), 'definitely-missing-installer.exe'), 'win32'))
})

/* ==================== 9. 配置 Schema：正例与反例 ==================== */

test('83 Config fills every field from identity defaults', () => {
  const config = Config({})
  assert.equal(typeof config.enabled, 'boolean')
  assert.equal(config.initialDelayMs, 60_000)
  assert.equal(config.intervalMs, 6 * 60 * 60 * 1000)
  assert.equal(config.requestTimeoutMs, 15_000)
  assert.equal(config.productName, 'TokensHarness')
  assert.equal(config.downloadBaseURL, '')
  assert.equal(config.releaseIndexURL, undefined)
  assert.equal(config.releaseAPIURL, undefined)
})

test('84 Config accepts explicit in-range overrides', () => {
  const config = Config({ enabled: false, initialDelayMs: 0, intervalMs: 1, requestTimeoutMs: 1 })
  assert.equal(config.enabled, false)
  assert.equal(config.initialDelayMs, 0)
  assert.equal(config.intervalMs, 1)
})

test('85 Config rejects a negative initial delay', () => {
  assert.throws(() => Config({ initialDelayMs: -1 }))
})

test('86 Config rejects a zero polling interval', () => {
  assert.throws(() => Config({ intervalMs: 0 }))
})

test('87 Config rejects a delay beyond the 32-bit timer ceiling', () => {
  assert.throws(() => Config({ intervalMs: 2_147_483_648 }))
  assert.throws(() => Config({ requestTimeoutMs: 2_147_483_648 }))
})

test('88 Config rejects a fractional millisecond value', () => {
  assert.throws(() => Config({ intervalMs: 1.5 }))
})

test('89 Config rejects wrongly typed fields', () => {
  assert.throws(() => Config({ enabled: 'yes' }))
  assert.throws(() => Config({ productName: 42 }))
  assert.throws(() => Config({ intervalMs: '1000' }))
  assert.throws(() => Config({ releaseIndexURL: 42 }))
  assert.throws(() => Config({ releaseAPIURL: false }))
})

test('90 release endpoints use Pages first and the GitHub API as fallback', () => {
  assert.match(RELEASE_INDEX_ENDPOINT, /^https:\/\/[^/]+\.github\.io\/[^/]+\/releases\.json$/u)
  assert.match(RELEASE_ENDPOINT, /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/latest$/u)
})

/* ==================== 10. 托盘与手动检查 ==================== */

test('91 tray registers once in the status group with a stable order', async () => {
  const root = await tempDir('tray')
  try {
    const host = harness({ root })
    const { tray, dispose } = host.start()
    assert.equal(tray.group, 'status')
    assert.equal(typeof tray.order, 'number')
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('92 tray shows the idle label before any check', async () => {
  const root = await tempDir('idle')
  try {
    const host = harness({ root })
    const { tray, dispose } = host.start()
    assert.equal(tray.label(), 'Check Updates…')
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('93 tray shows the available label after finding a newer release', async () => {
  const root = await tempDir('avail')
  try {
    const host = harness({ root, request: async () => release({ tag_name: 'v9.9.9' }) })
    const { tray, dispose } = host.start()
    await tray.invoke()
    assert.equal(tray.label(), 'TokensHarness 9.9.9 Available')
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('94 tray shows the checking label while a request is in flight', async () => {
  const root = await tempDir('checking')
  try {
    let release_
    const gate = new Promise(resolve => { release_ = resolve })
    const host = harness({ root, request: async () => { await gate; return release({ tag_name: 'v0.1.0' }) } })
    const { tray, dispose } = host.start()
    const pending = tray.invoke()
    assert.equal(tray.label(), 'Checking for Updates…')
    release_()
    await pending
    assert.equal(tray.label(), 'Check Updates…')
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('95 tray refresh is invoked around a manual check', async () => {
  const root = await tempDir('refresh')
  try {
    const host = harness({ root, request: async () => release({ tag_name: 'v0.1.0' }) })
    const { tray, dispose } = host.start()
    const before = host.registration.refreshCount
    await tray.invoke()
    assert.ok(host.registration.refreshCount > before, 'tray must repaint after a check')
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('96 manual check reports up-to-date through the adapter', async () => {
  const root = await tempDir('uptodate')
  try {
    const host = harness({ root, request: async () => release({ tag_name: 'v0.1.0' }) })
    const { tray, dispose } = host.start()
    await tray.invoke()
    assert.deepEqual(host.log.manual, [{
      status: 'up-to-date', currentVersion: '0.1.0', latestVersion: '0.1.0', assets: [],
    }])
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('97 manual check reports a failed lookup as null through the adapter', async () => {
  const root = await tempDir('failed')
  try {
    const host = harness({ root, request: async () => { throw new Error('offline') } })
    const { tray, dispose } = host.start()
    await tray.invoke()
    assert.deepEqual(host.log.manual, [null])
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('98 manual check prompts for download when a newer release exists', async () => {
  const root = await tempDir('prompt')
  try {
    const host = harness({ root, request: async () => release({ tag_name: 'v0.2.0' }) })
    const { tray, dispose } = host.start()
    await tray.invoke()
    assert.deepEqual(host.log.confirmed, ['0.2.0'])
    assert.deepEqual(host.log.manual, [], 'an available update must not show the up-to-date dialog')
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('99 manual check does not prompt when the adapter cannot download', async () => {
  const root = await tempDir('nodl')
  try {
    const host = harness({
      root,
      adapter: { canDownload: false },
      request: async () => release({ tag_name: 'v0.2.0' }),
    })
    const { tray, dispose } = host.start()
    await tray.invoke()
    assert.deepEqual(host.log.confirmed, [])
    assert.equal(tray.label(), 'Check Updates…')
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('100 concurrent manual invokes collapse into one network request', async () => {
  const root = await tempDir('single')
  try {
    let release_
    const gate = new Promise(resolve => { release_ = resolve })
    const host = harness({ root, request: async () => { await gate; return release({ tag_name: 'v0.1.0' }) } })
    const { tray, dispose } = host.start()
    const pending = [tray.invoke(), tray.invoke(), tray.invoke()]
    release_()
    await Promise.all(pending)
    assert.equal(host.log.requests.length, 1, 'single-flight must coalesce concurrent manual checks')
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('101 a second manual invoke after an available result reuses the cached version', async () => {
  const root = await tempDir('cached')
  try {
    const host = harness({ root, request: async () => release({ tag_name: 'v0.2.0' }) })
    const { tray, dispose } = host.start()
    await tray.invoke()
    const afterFirst = host.log.requests.length
    await tray.invoke()
    assert.equal(host.log.requests.length, afterFirst, 'a known available version must not re-query')
    assert.deepEqual(host.log.confirmed, ['0.2.0', '0.2.0'])
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ==================== 11. 提示状态持久化 ==================== */

test('102 declining a download still records the prompted version', async () => {
  const root = await tempDir('state')
  try {
    const host = harness({ root, request: async () => release({ tag_name: 'v0.2.0' }) })
    const { tray, dispose } = host.start()
    await tray.invoke()
    await dispose()
    const state = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'))
    assert.deepEqual(state, { version: 2, lastPromptedVersion: '0.2.0' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('103 a corrupt state file is repaired into a valid empty state', async () => {
  const root = await tempDir('corrupt')
  try {
    await writeFile(join(root, 'state.json'), 'not json at all')
    const host = harness({ root, request: async () => release({ tag_name: 'v0.1.0' }) })
    const { tray, dispose } = host.start()
    const settled = await waitForState(join(root, 'state.json'), text => text.trim() !== 'not json at all')
    assert.deepEqual(JSON.parse(settled), { version: 2 })
    await tray.invoke()
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('104 a state file from an unknown schema version is discarded', async () => {
  const root = await tempDir('v1')
  try {
    await writeFile(join(root, 'state.json'), JSON.stringify({ version: 1, lastPromptedVersion: '0.0.1' }))
    const host = harness({ root, request: async () => release({ tag_name: 'v0.2.0' }) })
    const { tray, dispose } = host.start()
    await tray.invoke()
    assert.deepEqual(host.log.confirmed, ['0.2.0'], 'a discarded state must not suppress the prompt')
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('105 a state file carrying unexpected keys is repaired', async () => {
  const root = await tempDir('extrakeys')
  try {
    await writeFile(join(root, 'state.json'), JSON.stringify({ version: 2, evil: true }))
    const host = harness({ root, request: async () => release({ tag_name: 'v0.1.0' }) })
    const { tray, dispose } = host.start()
    const settled = await waitForState(join(root, 'state.json'), text => !text.includes('evil'))
    assert.deepEqual(JSON.parse(settled), { version: 2 })
    await tray.invoke()
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('106 a state file with a non-stable remembered version is rejected', async () => {
  const root = await tempDir('badver')
  try {
    await writeFile(join(root, 'state.json'), JSON.stringify({ version: 2, lastPromptedVersion: 'v0.2.0' }))
    const host = harness({ root, request: async () => release({ tag_name: 'v0.2.0' }) })
    const { tray, dispose } = host.start()
    await tray.invoke()
    assert.deepEqual(host.log.confirmed, ['0.2.0'])
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('107 an oversized state file is rejected rather than parsed', async () => {
  const root = await tempDir('huge')
  try {
    await writeFile(join(root, 'state.json'), ' '.repeat(8 * 1024) + '{"version":2}')
    const host = harness({ root, request: async () => release({ tag_name: 'v0.2.0' }) })
    const { tray, dispose } = host.start()
    // An available update awaits stateReady before prompting, so this assertion
    // observes the completed repair instead of racing the background read.
    await tray.invoke()
    const settled = await readFile(join(root, 'state.json'), 'utf8')
    assert.deepEqual(JSON.parse(settled), { version: 2, lastPromptedVersion: '0.2.0' })
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('108 a missing state file is not written back on a clean up-to-date check', async () => {
  const root = await tempDir('absent')
  try {
    const host = harness({ root, request: async () => release({ tag_name: 'v0.1.0' }) })
    const { tray, dispose } = host.start()
    await tray.invoke()
    await dispose()
    assert.deepEqual(await readdir(root), [], 'an untouched install must not create state')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('109 an unwritable state path never breaks the update flow', async () => {
  const root = await tempDir('unwritable')
  try {
    const host = harness({
      root,
      adapter: { statePath: join(root, 'state.json', 'nested', 'state.json') },
      request: async () => release({ tag_name: 'v0.2.0' }),
    })
    await writeFile(join(root, 'state.json'), 'x')
    const { tray, dispose } = host.start()
    await tray.invoke()
    assert.deepEqual(host.log.confirmed, ['0.2.0'])
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ==================== 12. 生命周期与卸载 ==================== */

test('110 dispose releases the tray registration', async () => {
  const root = await tempDir('dispose')
  try {
    const host = harness({ root })
    const { dispose } = host.start()
    await dispose()
    assert.equal(host.registration.disposed, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('111 dispose aborts an in-flight version request', async () => {
  const root = await tempDir('abortreq')
  try {
    let observed
    const host = harness({
      root,
      request: async (_url, init) => {
        observed = init.signal
        await new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => { reject(init.signal.reason) })
        })
        return release()
      },
    })
    const { tray, dispose } = host.start()
    const pending = tray.invoke()
    await dispose()
    await pending
    assert.equal(observed.aborted, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('112 dispose is idempotent', async () => {
  const root = await tempDir('twice')
  try {
    const host = harness({ root })
    const { dispose } = host.start()
    await dispose()
    await assert.doesNotReject(dispose())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('113 a manual check started after dispose reports nothing to the user', async () => {
  const root = await tempDir('afterdispose')
  try {
    const host = harness({ root, request: async () => release({ tag_name: 'v0.2.0' }) })
    const { tray, dispose } = host.start()
    await dispose()
    await tray.invoke()
    assert.deepEqual(host.log.confirmed, [], 'a disposed plugin must not open dialogs')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('114 an unpackaged build never schedules background polling', async () => {
  const root = await tempDir('unpackaged')
  try {
    const host = harness({ root, request: async () => release({ tag_name: 'v0.2.0' }) })
    const { dispose } = host.start({ enabled: true, initialDelayMs: 0 })
    await new Promise(resolve => { setTimeout(resolve, 30) })
    assert.deepEqual(host.log.requests, [], 'development builds must not poll GitHub')
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('115 a packaged build with polling disabled never contacts GitHub', async () => {
  const root = await tempDir('disabled')
  try {
    const host = harness({
      root,
      adapter: { isPackaged: true },
      request: async () => release({ tag_name: 'v0.2.0' }),
    })
    const { dispose } = host.start({ enabled: false, initialDelayMs: 0 })
    await new Promise(resolve => { setTimeout(resolve, 30) })
    assert.deepEqual(host.log.requests, [])
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('116 a packaged build with polling enabled checks after the initial delay', async () => {
  const root = await tempDir('polling')
  try {
    const host = harness({
      root,
      adapter: { isPackaged: true },
      request: async () => release({ tag_name: 'v0.2.0' }),
    })
    const { dispose } = host.start({ enabled: true, initialDelayMs: 1, intervalMs: 3_600_000 })
    await new Promise(resolve => { setTimeout(resolve, 80) })
    assert.equal(host.log.requests.length, 1)
    assert.deepEqual(host.log.confirmed, ['0.2.0'])
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('117 background polling prompts only once for the same version', async () => {
  const root = await tempDir('dedupe')
  try {
    const host = harness({
      root,
      adapter: { isPackaged: true },
      request: async () => release({ tag_name: 'v0.2.0' }),
    })
    const { dispose } = host.start({ enabled: true, initialDelayMs: 1, intervalMs: 20 })
    await new Promise(resolve => { setTimeout(resolve, 140) })
    await dispose()
    assert.ok(host.log.requests.length >= 2, 'the poll loop must keep running')
    assert.deepEqual(host.log.confirmed, ['0.2.0'], 'the same version must be offered only once')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('118 background polling prompts again after app restart', async () => {
  const root = await tempDir('restart-prompt')
  try {
    await writeFile(join(root, 'state.json'), JSON.stringify({ version: 2, lastPromptedVersion: '0.2.0' }))
    const host = harness({
      root,
      adapter: { isPackaged: true },
      request: async () => release({ tag_name: 'v0.2.0' }),
    })
    const { dispose } = host.start({ enabled: true, initialDelayMs: 1, intervalMs: 3_600_000 })
    await new Promise(resolve => { setTimeout(resolve, 80) })
    await dispose()
    assert.deepEqual(host.log.confirmed, ['0.2.0'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('119 dispose stops the background poll loop', async () => {
  const root = await tempDir('stoppoll')
  try {
    const host = harness({
      root,
      adapter: { isPackaged: true },
      request: async () => release({ tag_name: 'v0.1.0' }),
    })
    const { dispose } = host.start({ enabled: true, initialDelayMs: 1, intervalMs: 10 })
    await new Promise(resolve => { setTimeout(resolve, 50) })
    await dispose()
    const settled = host.log.requests.length
    await new Promise(resolve => { setTimeout(resolve, 60) })
    assert.equal(host.log.requests.length, settled, 'no request may start after dispose')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('120 a request timeout aborts the check and surfaces a failed lookup', async () => {
  const root = await tempDir('timeout')
  try {
    const host = harness({
      root,
      request: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => { reject(init.signal.reason) })
      }),
    })
    const { tray, dispose } = host.start({ requestTimeoutMs: 20 })
    await tray.invoke()
    assert.deepEqual(host.log.manual, [null])
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('121 a rejected confirmation leaves the plugin usable for the next check', async () => {
  const root = await tempDir('confirmthrow')
  try {
    const host = harness({
      root,
      request: async () => release({ tag_name: 'v0.2.0' }),
      adapter: { async confirmDownload() { throw new Error('dialog crashed') } },
    })
    const { tray, dispose } = host.start()
    await assert.doesNotReject(tray.invoke())
    assert.equal(tray.label(), 'TokensHarness 0.2.0 Available')
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ==================== 13. 确认后的完整下载链路 ==================== */

/** 构造一个可下载的 Release：含当前平台安装包与正确摘要。 */
function downloadableRelease(version, payload, platform = process.platform, arch = process.arch) {
  const suffix = platform === 'win32'
    ? 'windows-amd64-installer.exe'
    : arch === 'arm64' ? 'macos-arm64-installer.dmg' : 'macos-amd64-installer.dmg'
  return {
    name: `TokensHarness-${version}-${suffix}`,
    digest: `sha256:${createHash('sha256').update(payload).digest('hex')}`,
    size: payload.byteLength,
    body: payload,
  }
}

function isReleaseMetadataRequest(url) {
  return url.endsWith('/releases.json') || url.endsWith('/releases/latest')
}

const SUPPORTED_HOST = selectInstallerAsset(
  [{ name: `x-${process.platform === 'win32' ? 'windows-amd64-installer.exe' : 'macos-arm64-installer.dmg'}`, url: 'https://github.com/x', size: 1, digest: null }],
) !== null

test('122 confirming a download fetches and verifies the installer end to end', {
  skip: SUPPORTED_HOST ? false : 'unsupported host platform',
}, async () => {
  const root = await tempDir('e2e')
  try {
    const payload = Buffer.from('verified-installer-bytes')
    const asset = downloadableRelease('0.2.0', payload)
    const host = harness({
      root,
      confirm: true,
      request: async (url) => isReleaseMetadataRequest(url)
        ? release({
          tag_name: 'v0.2.0',
          assets: [{
            name: asset.name,
            browser_download_url: 'https://github.com/o/r/releases/download/v0.2.0/' + asset.name,
            size: asset.size,
            digest: asset.digest,
          }],
        })
        : new Response(payload),
    })
    const { tray, dispose } = host.start()
    await tray.invoke()
    const settled = await waitForState(join(root, '0.2.0', asset.name), () => true)
    assert.equal(settled, payload.toString('utf8'))
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('123 a tampered installer is never written to its final path', {
  skip: SUPPORTED_HOST ? false : 'unsupported host platform',
}, async () => {
  const root = await tempDir('tamper')
  try {
    const asset = downloadableRelease('0.2.0', Buffer.from('honest-bytes'))
    const host = harness({
      root,
      confirm: true,
      request: async (url) => isReleaseMetadataRequest(url)
        ? release({
          tag_name: 'v0.2.0',
          assets: [{
            name: asset.name,
            browser_download_url: 'https://github.com/o/r/releases/download/v0.2.0/' + asset.name,
            size: asset.size,
            digest: asset.digest,
          }],
        })
        : new Response(Buffer.from('EVIL-PAYLOAD')),
    })
    const { tray, dispose } = host.start()
    await tray.invoke()
    await dispose()
    const entries = await readdir(join(root, '0.2.0')).catch(() => [])
    assert.deepEqual(entries, [], 'a digest mismatch must leave the directory empty')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('124 a release without a matching installer asset downloads nothing', async () => {
  const root = await tempDir('noasset')
  try {
    const host = harness({
      root,
      confirm: true,
      request: async () => release({
        tag_name: 'v0.2.0',
        assets: [{ name: 'notes.txt', browser_download_url: 'https://github.com/a/notes.txt', size: 3 }],
      }),
    })
    const { tray, dispose } = host.start()
    await tray.invoke()
    await dispose()
    assert.deepEqual(await readdir(root), ['state.json'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('125 declining the confirmation dialog downloads nothing', async () => {
  const root = await tempDir('decline')
  try {
    const asset = downloadableRelease('0.2.0', Buffer.from('bytes'))
    let installerRequests = 0
    const host = harness({
      root,
      confirm: false,
      request: async (url) => {
        if (isReleaseMetadataRequest(url)) {
          return release({
            tag_name: 'v0.2.0',
            assets: [{
              name: asset.name,
              browser_download_url: 'https://github.com/o/r/d/' + asset.name,
              size: asset.size,
              digest: asset.digest,
            }],
          })
        }
        installerRequests += 1
        return new Response(asset.body)
      },
    })
    const { tray, dispose } = host.start()
    await tray.invoke()
    await dispose()
    assert.equal(installerRequests, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('126 the download mirror prefix rewrites the GitHub asset host', {
  skip: SUPPORTED_HOST ? false : 'unsupported host platform',
}, async () => {
  const root = await tempDir('mirrorcfg')
  try {
    const payload = Buffer.from('mirrored-bytes')
    const asset = downloadableRelease('0.2.0', payload)
    const seen = []
    const host = harness({
      root,
      confirm: true,
      request: async (url) => {
        seen.push(url)
        return isReleaseMetadataRequest(url)
          ? release({
            tag_name: 'v0.2.0',
            assets: [{
              name: asset.name,
              browser_download_url: 'https://github.com/o/r/releases/download/v0.2.0/' + asset.name,
              size: asset.size,
              digest: asset.digest,
            }],
          })
          : new Response(payload)
      },
    })
    const { tray, dispose } = host.start({ downloadBaseURL: 'https://mirror.test/https://github.com' })
    await tray.invoke()
    await waitForState(join(root, '0.2.0', asset.name), () => true)
    await dispose()
    assert.ok(
      seen.some(url => url.startsWith('https://mirror.test/https://github.com/o/r/')),
      `installer must be fetched through the mirror; saw ${JSON.stringify(seen)}`,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('127 a non-HTTPS mirror prefix is ignored and GitHub is used directly', {
  skip: SUPPORTED_HOST ? false : 'unsupported host platform',
}, async () => {
  const root = await tempDir('badmirror')
  try {
    const payload = Buffer.from('direct-bytes')
    const asset = downloadableRelease('0.2.0', payload)
    const seen = []
    const host = harness({
      root,
      confirm: true,
      request: async (url) => {
        seen.push(url)
        return isReleaseMetadataRequest(url)
          ? release({
            tag_name: 'v0.2.0',
            assets: [{
              name: asset.name,
              browser_download_url: 'https://github.com/o/r/releases/download/v0.2.0/' + asset.name,
              size: asset.size,
              digest: asset.digest,
            }],
          })
          : new Response(payload)
      },
    })
    const { tray, dispose } = host.start({ downloadBaseURL: 'http://evil.test' })
    await tray.invoke()
    await waitForState(join(root, '0.2.0', asset.name), () => true)
    await dispose()
    assert.ok(seen.every(url => !url.includes('evil.test')), 'a plaintext mirror must never be contacted')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('128 the tray reports the downloading state while an installer transfers', {
  skip: SUPPORTED_HOST ? false : 'unsupported host platform',
}, async () => {
  const root = await tempDir('dlstate')
  try {
    const payload = Buffer.from('slow-bytes')
    const asset = downloadableRelease('0.2.0', payload)
    let openGate
    const gate = new Promise(resolve => { openGate = resolve })
    const host = harness({
      root,
      confirm: true,
      request: async (url) => {
        if (isReleaseMetadataRequest(url)) {
          return release({
            tag_name: 'v0.2.0',
            assets: [{
              name: asset.name,
              browser_download_url: 'https://github.com/o/r/d/' + asset.name,
              size: asset.size,
              digest: asset.digest,
            }],
          })
        }
        await gate
        return new Response(payload)
      },
    })
    const { tray, dispose } = host.start()
    const pending = tray.invoke()
    await waitForState(join(root, 'state.json'), text => text.includes('0.2.0'))
    await new Promise(resolve => { setTimeout(resolve, 20) })
    assert.equal(tray.label(), 'Downloading TokensHarness 0.2.0…')
    openGate()
    await pending
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('179 download rejects unsafe asset names before network or filesystem effects', async () => {
  const root = await tempDir('unsafe-name')
  let requests = 0
  try {
    for (const name of ['../escape.exe', '..\\escape.exe', '/absolute.exe', 'C:drive.exe', 'CON.exe', 'bad.exe.', 'bad\u0000.exe']) {
      await assert.rejects(downloadInstaller({
        asset: { name, size: 1, digest: null }, url: 'https://example.test/a',
        request: async () => { requests++; return new Response('x') },
        directory: join(root, 'new'),
      }), /asset name/u)
    }
    assert.equal(selectInstallerAsset([{ name: '../bad-windows-amd64-installer.exe' }], 'win32', 'x64'), null)
    assert.equal(requests, 0)
    assert.deepEqual(await readdir(root), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('180 download rejects truncated bytes and preserves the existing installer', async () => {
  const root = await tempDir('truncated')
  try {
    await writeFile(join(root, 'existing.exe'), 'original')
    await assert.rejects(downloadInstaller({
      asset: { name: 'existing.exe', size: 10, digest: null }, url: 'https://example.test/a',
      request: async () => new Response('short'), directory: root,
    }), /size mismatch/u)
    assert.equal(await readFile(join(root, 'existing.exe'), 'utf8'), 'original')
    assert.deepEqual(await readdir(root), ['existing.exe'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('181 download writes every byte when the filesystem performs short writes', async t => {
  const { open } = await import('node:fs/promises')
  const root = await tempDir('short-write')
  const probe = await open(join(root, 'probe'), 'w')
  const prototype = Object.getPrototypeOf(probe)
  const original = prototype.write
  await probe.close()
  const mocked = t.mock.method(prototype, 'write', function (buffer, offset = 0, length = buffer.byteLength - offset) {
    return original.call(this, buffer, offset, Math.min(3, length))
  })
  try {
    const payload = Buffer.from('complete-binary-payload')
    const path = await downloadInstaller({
      asset: { name: 'complete.exe', size: payload.length, digest: `sha256:${createHash('sha256').update(payload).digest('hex')}` },
      url: 'https://example.test/a', request: async () => new Response(payload), directory: root,
    })
    assert.deepEqual(await readFile(path), payload)
    assert.ok(mocked.mock.calls.length > 1)
  } finally { mocked.mock.restore(); await rm(root, { recursive: true, force: true }) }
})

test('182 cancellation cleans up a stalled stream even if fetch ignores the signal', { timeout: 2000 }, async () => {
  const root = await tempDir('stalled-stream')
  const controller = new AbortController()
  let cancelled = false
  try {
    const pending = downloadInstaller({
      asset: { name: 'stalled.exe', size: 10, digest: null }, url: 'https://example.test/a',
      request: async () => new Response(new ReadableStream({ cancel() { cancelled = true } })),
      directory: root, signal: controller.signal,
      onProgress: () => { setTimeout(() => controller.abort(new Error('cancel-stalled')), 20) },
    })
    await assert.rejects(pending, /cancel-stalled/u)
    assert.equal(cancelled, true)
    assert.deepEqual(await readdir(root), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('183 manual dialogs localize failure, available and current outcomes with English fallback', () => {
  const options = { productName: 'MyBrand', releasesPageURL: 'https://example.test/releases', locale: 'zh-CN' }
  assert.deepEqual(describeManualCheck(null, options), {
    type: 'warning', title: '无法检查更新', message: 'MyBrand 无法检查更新。', detail: '请稍后重试。',
  })
  const available = { status: 'update-available', latestVersion: '2.0.0', currentVersion: '1.0.0' }
  assert.deepEqual(describeManualCheck(available, options), {
    type: 'info', title: 'MyBrand 有可用更新', message: 'MyBrand 2.0.0 已发布。',
    detail: '此构建无法自动安装更新，请手动下载：\n\nhttps://example.test/releases',
  })
  const current = { ...available, status: 'up-to-date' }
  assert.deepEqual(describeManualCheck(current, { ...options, locale: 'zh-TW' }), {
    type: 'info', title: 'MyBrand 已是最新版本', message: 'MyBrand 暂无更新版本。', detail: '已安装版本：1.0.0',
  })
  for (const result of [null, available, current]) {
    const english = describeManualCheck(result, { ...options, locale: 'en-US' })
    assert.deepEqual(describeManualCheck(result, { ...options, locale: 'fr-FR' }), english)
    assert.deepEqual(describeManualCheck(result, { ...options, locale: undefined }), english)
    assert.doesNotMatch(JSON.stringify(english), /[\u3400-\u9fff]/u)
  }
})

test('184 tray reads the current host locale for idle, checking and available states', async () => {
  const root = await tempDir('tray-locale')
  let releaseRequest
  try {
    const gate = new Promise(resolve => { releaseRequest = resolve })
    const host = harness({ root, request: async () => { await gate; return release() } })
    host.ctx.desktopRuntime.locale = 'zh-CN'
    const instance = host.start()
    try {
      assert.equal(instance.tray.label(), '检查更新…')
      const pending = instance.tray.invoke()
      assert.equal(instance.tray.label(), '正在检查更新…')
      releaseRequest()
      await pending
      assert.equal(instance.tray.label(), 'TokensHarness 0.2.0 有可用更新')
      host.ctx.desktopRuntime.locale = 'en-US'
      assert.equal(instance.tray.label(), 'TokensHarness 0.2.0 Available')
    } finally { releaseRequest(); await instance.dispose() }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('171 download rechecks a withdrawn or prerelease target before fetching bytes', {
  skip: SUPPORTED_HOST ? false : 'unsupported host platform',
}, async (t) => {
  mockInstallerLaunch(t)

  for (const changedRelease of [
    { tag_name: 'v0.1.0' },
    { tag_name: 'v0.2.0', prerelease: true },
  ]) {
    const root = await tempDir('recheck-reject')
    const payload = Buffer.from('installer-bytes')
    const asset = downloadableRelease('0.2.0', payload)
    let currentRelease = release({
      tag_name: 'v0.2.0',
      assets: [{
        name: asset.name,
        browser_download_url: `https://github.com/o/r/${asset.name}`,
        size: asset.size,
        digest: asset.digest,
      }],
    })
    let downloads = 0
    const host = harness({
      root,
      connection: true,
      confirm: false,
      request: async () => currentRelease.clone(),
      downloadRequest: async () => {
        downloads += 1
        return new Response(payload)
      },
    })
    const { tray, rpc, dispose } = host.start()
    try {
      await tray.invoke()
      currentRelease = release(changedRelease)
      assert.deepEqual(await rpc('download'), { ok: true, value: { started: false } })
      assert.equal(downloads, 0, 'a changed target must be rejected before its bytes are fetched')
    } finally {
      await dispose()
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('172 download refreshes to a newer stable target before allowing a retry', {
  skip: SUPPORTED_HOST ? false : 'unsupported host platform',
}, async (t) => {
  mockInstallerLaunch(t)
  const root = await tempDir('recheck-newer')
  const oldPayload = Buffer.from('old-installer')
  const newPayload = Buffer.from('new-installer')
  const oldAsset = downloadableRelease('0.2.0', oldPayload)
  const newAsset = downloadableRelease('0.3.0', newPayload)
  let currentVersion = '0.2.0'
  let downloads = 0
  const host = harness({
    root,
    connection: true,
    confirm: false,
    request: async () => {
      const asset = currentVersion === '0.2.0' ? oldAsset : newAsset
      return release({
        tag_name: `v${currentVersion}`,
        assets: [{
          name: asset.name,
          browser_download_url: `https://github.com/o/r/${asset.name}`,
          size: asset.size,
          digest: asset.digest,
        }],
      })
    },
    downloadRequest: async () => {
      downloads += 1
      return new Response(newPayload)
    },
  })
  const { tray, rpc, dispose } = host.start()
  try {
    await tray.invoke()
    currentVersion = '0.3.0'
    assert.deepEqual(await rpc('download'), { ok: true, value: { started: false } })
    assert.deepEqual(await rpc('status'), {
      ok: true,
      value: { phase: 'available', productName: 'TokensHarness', version: '0.3.0' },
    })
    assert.deepEqual(await rpc('download'), { ok: true, value: { started: true } })
    assert.equal(downloads, 1)
    assert.deepEqual(await readFile(join(root, '0.3.0', newAsset.name)), newPayload)
  } finally {
    await dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('173 filesystem destination failures preserve existing files and allow retry', async () => {
  const root = await tempDir('filesystem-retry')
  const directory = join(root, 'downloads')
  const payload = Buffer.from('replacement-installer')
  const asset = downloadableRelease('0.2.0', payload, 'win32', 'x64')
  const finalPath = join(directory, asset.name)
  const partialPath = join(directory, `.${asset.name}.${process.pid}.partial`)
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(finalPath, Buffer.from('existing-installer'))
    await mkdir(partialPath)

    await assert.rejects(downloadInstaller({
      asset,
      url: 'https://github.com/o/r/installer.exe',
      request: async () => new Response(payload),
      directory,
    }))
    assert.deepEqual(await readFile(finalPath), Buffer.from('existing-installer'))

    await rm(partialPath, { recursive: true, force: true })
    assert.equal(await downloadInstaller({
      asset,
      url: 'https://github.com/o/r/installer.exe',
      request: async () => new Response(payload),
      directory,
    }), finalPath)
    assert.deepEqual(await readFile(finalPath), payload)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('174 disposing a stalled download aborts it and a new session can retry', {
  skip: SUPPORTED_HOST ? false : 'unsupported host platform',
}, async (t) => {
  mockInstallerLaunch(t)
  const root = await tempDir('stalled-retry')
  const payload = Buffer.from('retry-installer')
  const asset = downloadableRelease('0.2.0', payload)
  let stalledRequestStarted
  const started = new Promise(resolve => { stalledRequestStarted = resolve })
  const releaseResponse = () => release({
    tag_name: 'v0.2.0',
    assets: [{
      name: asset.name,
      browser_download_url: `https://github.com/o/r/${asset.name}`,
      size: asset.size,
      digest: asset.digest,
    }],
  })
  const stalled = harness({
    root,
    connection: true,
    confirm: false,
    request: async () => releaseResponse(),
    downloadRequest: async (_url, init) => new Promise((resolve, reject) => {
      stalledRequestStarted()
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    }),
  })
  const first = stalled.start()
  try {
    await first.tray.invoke()
    const pending = first.rpc('download')
    await started
    await first.dispose()
    assert.deepEqual(await pending, { ok: true, value: { started: false } })

    const retry = harness({
      root,
      connection: true,
      confirm: false,
      request: async () => releaseResponse(),
      downloadRequest: async () => new Response(payload),
    }).start()
    try {
      await retry.tray.invoke()
      assert.deepEqual(await retry.rpc('download'), { ok: true, value: { started: true } })
      assert.deepEqual(await readFile(join(root, '0.2.0', asset.name)), payload)
    } finally {
      await retry.dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('175 a failed version lookup can recover on the next manual check', async () => {
  const root = await tempDir('lookup-recovery')
  let available = false
  const host = harness({
    root,
    request: async () => {
      if (!available) throw new Error('temporary network failure')
      return release({ tag_name: 'v0.2.0' })
    },
  })
  const { tray, dispose } = host.start()
  try {
    await tray.invoke()
    assert.deepEqual(host.log.manual, [null])

    available = true
    await tray.invoke()
    assert.deepEqual(host.log.confirmed, ['0.2.0'])
    assert.equal(tray.label(), 'TokensHarness 0.2.0 Available')
  } finally {
    await dispose()
    await rm(root, { recursive: true, force: true })
  }
})

/* ==================== 14. 文档与清单一致性 ==================== */

test('129 the package manifest exposes the documented entry points', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.exports['./client'], './dist/client.js')
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const file of ['index.js', 'download.js', 'identity.js', 'dist/client.js', 'cordis.patch.yml']) {
    assert.ok(manifest.files.includes(file), `${file} must ship in the published package`)
  }
})

test('130 the README documents the release source that identity.js actually queries', async () => {
  const { GITHUB_OWNER, GITHUB_REPO } = await import('../identity.js')
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  assert.ok(
    readme.includes(`${GITHUB_OWNER}/${GITHUB_REPO}`),
    `README must name the live release source ${GITHUB_OWNER}/${GITHUB_REPO}`,
  )
})

test('131 the README documents the asset names the downloader actually matches', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  for (const suffix of ['windows-amd64-installer.exe', 'macos-arm64-installer.dmg']) {
    assert.ok(readme.includes(suffix), `README must document the ${suffix} asset`)
  }
})
/* ==================== 15. 手动检查弹窗文案 ==================== */

const DIALOG_BRAND = { productName: 'TokensHarness', releasesPageURL: 'https://github.com/TokensAPI/tokens_TokensHarness_code/releases/latest' }

test('132 a failed manual check is described as a warning that asks the user to retry', () => {
  const dialog = describeManualCheck(null, DIALOG_BRAND)
  assert.equal(dialog.type, 'warning')
  assert.equal(dialog.title, 'Unable to Check for Updates')
  assert.equal(dialog.message, 'TokensHarness could not check for updates.')
  assert.equal(dialog.detail, 'Please try again later.')
})

test('133 an up-to-date manual check names the installed version and claims no newer build', () => {
  const dialog = describeManualCheck(
    { status: 'up-to-date', currentVersion: '0.1.2', latestVersion: '0.1.2', assets: [] },
    DIALOG_BRAND,
  )
  assert.equal(dialog.type, 'info')
  assert.equal(dialog.title, 'TokensHarness Is Up to Date')
  assert.equal(dialog.detail, 'Installed version: 0.1.2')
})

test('134 an available update is never described as up to date', () => {
  const dialog = describeManualCheck(
    { status: 'update-available', currentVersion: '0.1.2', latestVersion: '0.2.0', assets: [] },
    DIALOG_BRAND,
  )
  assert.equal(dialog.type, 'info')
  assert.equal(dialog.title, 'TokensHarness Update Available')
  assert.equal(dialog.message, 'TokensHarness 0.2.0 is available.')
  assert.ok(!dialog.message.includes('No newer version'))
  assert.ok(!dialog.detail.includes('No newer version'))
})

test('135 an available update points the user at the manual download page', () => {
  const dialog = describeManualCheck(
    { status: 'update-available', currentVersion: '0.1.2', latestVersion: '0.2.0', assets: [] },
    DIALOG_BRAND,
  )
  assert.ok(dialog.detail.includes(DIALOG_BRAND.releasesPageURL))
  assert.ok(dialog.detail.startsWith('This build cannot install updates automatically.'))
})

test('136 every dialog carries the configured brand rather than the built-in default', () => {
  const brand = { productName: 'MyBrand', releasesPageURL: 'https://github.com/my-org/my_repo/releases/latest' }
  const cases = [
    null,
    { status: 'up-to-date', currentVersion: '1.0.0', latestVersion: '1.0.0', assets: [] },
    { status: 'update-available', currentVersion: '1.0.0', latestVersion: '2.0.0', assets: [] },
  ]
  for (const result of cases) {
    const dialog = describeManualCheck(result, brand)
    assert.ok(
      `${dialog.title} ${dialog.message} ${dialog.detail}`.includes('MyBrand')
      || dialog.detail.includes(brand.releasesPageURL),
      `dialog for ${String(result?.status)} must carry the configured brand`,
    )
    assert.ok(!dialog.detail.includes('TokensHarness'))
  }
})

test('137 the manual download link is an HTTPS GitHub releases URL, never a mirror or plaintext host', () => {
  const dialog = describeManualCheck(
    { status: 'update-available', currentVersion: '0.1.2', latestVersion: '0.2.0', assets: [] },
    DIALOG_BRAND,
  )
  const url = dialog.detail.slice(dialog.detail.indexOf('https://'))
  assert.ok(url.startsWith('https://github.com/'))
  assert.ok(url.endsWith('/releases/latest'))
  assert.ok(!dialog.detail.includes('http://'))
})

test('138 a runtime that cannot download still reports the available version to the host adapter', async () => {
  const root = await tempDir('nodl')
  try {
    const bench = harness({
      root,
      adapter: { canDownload: false },
      request: async () => release({ tag_name: 'v0.2.0' }),
    })
    const { tray, dispose } = bench.start()
    await tray.invoke()
    assert.equal(bench.log.confirmed.length, 0, 'a runtime without download support must not prompt')
    assert.deepEqual(bench.log.manual, [{
      status: 'update-available',
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      assets: [],
    }], 'the host adapter must still learn that a newer version exists')
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('139 the describeManualCheck contract stays a pure function of its inputs', () => {
  const result = Object.freeze({ status: 'update-available', currentVersion: '0.1.2', latestVersion: '0.2.0', assets: Object.freeze([]) })
  const first = describeManualCheck(result, DIALOG_BRAND)
  const second = describeManualCheck(result, DIALOG_BRAND)
  assert.deepEqual(first, second)
  assert.deepEqual(Object.keys(first).sort(), ['detail', 'message', 'title', 'type'])
})

/* ============ 16. 已下载安装包的复用 ============ */

/** 写出一个内容确定的安装包，返回其路径与配套的 asset 描述。 */
async function seedInstaller(directory, name, payload) {
  const path = join(directory, name)
  await writeFile(path, payload)
  return {
    path,
    asset: {
      name,
      url: `https://github.com/o/r/releases/download/v0.2.0/${name}`,
      size: payload.byteLength,
      digest: `sha256:${createHash('sha256').update(payload).digest('hex')}`,
    },
  }
}

test('140 verifyDownloadedInstaller accepts a file whose digest matches the release asset', async () => {
  const root = await tempDir('verify-hit')
  try {
    const { path, asset } = await seedInstaller(root, 'a.exe', Buffer.from('installer-bytes'))
    assert.equal(await verifyDownloadedInstaller(path, asset), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('141 verifyDownloadedInstaller hashes a file spanning several read buffers', async () => {
  const root = await tempDir('verify-big')
  try {
    const payload = Buffer.alloc(3 * 1024 * 1024 + 7, 0x41)
    const { path, asset } = await seedInstaller(root, 'big.exe', payload)
    assert.equal(await verifyDownloadedInstaller(path, asset), true, 'chunked hashing must cover the whole file')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('142 verifyDownloadedInstaller accepts an uppercase digest from the release document', async () => {
  const root = await tempDir('verify-case')
  try {
    const { path, asset } = await seedInstaller(root, 'c.exe', Buffer.from('installer-bytes'))
    const upper = { ...asset, digest: `sha256:${asset.digest.slice('sha256:'.length).toUpperCase()}` }
    assert.equal(await verifyDownloadedInstaller(path, upper), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('143 verifyDownloadedInstaller rejects a file whose bytes were tampered with', async () => {
  const root = await tempDir('verify-tamper')
  try {
    const { path, asset } = await seedInstaller(root, 'd.exe', Buffer.from('installer-bytes'))
    await writeFile(path, Buffer.from('tampered-bytes!'))
    assert.equal(await verifyDownloadedInstaller(path, asset), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('144 verifyDownloadedInstaller rejects a size that disagrees with the release asset', async () => {
  const root = await tempDir('verify-size')
  try {
    const { path, asset } = await seedInstaller(root, 'e.exe', Buffer.from('installer-bytes'))
    assert.equal(await verifyDownloadedInstaller(path, { ...asset, size: asset.size + 1 }), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('145 verifyDownloadedInstaller reports a missing file instead of throwing', async () => {
  const root = await tempDir('verify-gone')
  try {
    const asset = { name: 'f.exe', url: 'https://github.com/x', size: 4, digest: `sha256:${'a'.repeat(64)}` }
    assert.equal(await verifyDownloadedInstaller(join(root, 'f.exe'), asset), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('146 verifyDownloadedInstaller rejects a directory standing where the installer belongs', async () => {
  const root = await tempDir('verify-dir')
  try {
    const asset = { name: 'g.exe', url: 'https://github.com/x', size: 4, digest: `sha256:${'a'.repeat(64)}` }
    assert.equal(await verifyDownloadedInstaller(root, asset), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('147 verifyDownloadedInstaller rejects an empty file', async () => {
  const root = await tempDir('verify-empty')
  try {
    const { path, asset } = await seedInstaller(root, 'h.exe', Buffer.alloc(0))
    assert.equal(await verifyDownloadedInstaller(path, asset), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('148 verifyDownloadedInstaller refuses to trust a release that declares no digest', async () => {
  const root = await tempDir('verify-nodigest')
  try {
    const { path, asset } = await seedInstaller(root, 'i.exe', Buffer.from('installer-bytes'))
    for (const digest of [null, undefined]) {
      assert.equal(await verifyDownloadedInstaller(path, { ...asset, digest }), false, String(digest))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('149 verifyDownloadedInstaller returns false rather than throwing on a malformed digest', async () => {
  const root = await tempDir('verify-malformed')
  try {
    const { path, asset } = await seedInstaller(root, 'j.exe', Buffer.from('installer-bytes'))
    for (const digest of ['sha256:zz', 'md5:abc', 'not-a-digest', `sha512:${'a'.repeat(64)}`, 42]) {
      assert.equal(await verifyDownloadedInstaller(path, { ...asset, digest }), false, String(digest))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('150 an installer already on disk is reused without any network download', {
  skip: SUPPORTED_HOST ? false : 'unsupported host platform',
}, async () => {
  const root = await tempDir('reuse-hit')
  try {
    const payload = Buffer.from('already-downloaded-bytes')
    const asset = downloadableRelease('0.2.0', payload)
    await mkdir(join(root, '0.2.0'), { recursive: true })
    await writeFile(join(root, '0.2.0', asset.name), payload)

    let downloads = 0
    const host = harness({
      root,
      confirm: true,
      request: async (url) => {
        if (isReleaseMetadataRequest(url)) {
          return release({
            tag_name: 'v0.2.0',
            assets: [{
              name: asset.name,
              browser_download_url: `https://github.com/o/r/releases/download/v0.2.0/${asset.name}`,
              size: asset.size,
              digest: asset.digest,
            }],
          })
        }
        downloads += 1
        return new Response(Buffer.from('SHOULD-NEVER-BE-FETCHED'))
      },
    })
    const { tray, dispose } = host.start()
    await tray.invoke()
    await dispose()
    assert.equal(downloads, 0, 'a verified installer must be reused, never refetched')
    assert.deepEqual(await readFile(join(root, '0.2.0', asset.name)), payload, 'the reused file must be left intact')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('151 a tampered installer on disk is refetched instead of being trusted', {
  skip: SUPPORTED_HOST ? false : 'unsupported host platform',
}, async () => {
  const root = await tempDir('reuse-miss')
  try {
    const payload = Buffer.from('genuine-installer-bytes')
    const asset = downloadableRelease('0.2.0', payload)
    await mkdir(join(root, '0.2.0'), { recursive: true })
    await writeFile(join(root, '0.2.0', asset.name), Buffer.from('tampered-installer-bytes'))

    let downloads = 0
    const host = harness({
      root,
      confirm: true,
      request: async (url) => {
        if (isReleaseMetadataRequest(url)) {
          return release({
            tag_name: 'v0.2.0',
            assets: [{
              name: asset.name,
              browser_download_url: `https://github.com/o/r/releases/download/v0.2.0/${asset.name}`,
              size: asset.size,
              digest: asset.digest,
            }],
          })
        }
        downloads += 1
        return new Response(payload)
      },
    })
    const { tray, dispose } = host.start()
    await tray.invoke()
    const settled = await waitForState(join(root, '0.2.0', asset.name), text => text === payload.toString('utf8'))
    await dispose()
    assert.equal(downloads, 1, 'a digest mismatch on disk must fall through to the network')
    assert.equal(settled, payload.toString('utf8'), 'the tampered file must be replaced by the verified one')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ============ 17. 安装包下载目录的默认位置与配置 ============ */

const STATE_PATH = join(tmpdir(), 'dvu-resolve', 'DSH Desktop', 'updates', 'state.json')
const STATE_SIBLING = join(tmpdir(), 'dvu-resolve', 'DSH Desktop', 'updates', '0.2.0')
const ABSOLUTE_TARGET = process.platform === 'win32' ? 'D:\\Installers' : '/srv/installers'
const WIN_ENV = { APPDATA: join('C:', 'Users', 'tester', 'AppData', 'Roaming') }

/** 解析上下文：默认走 Windows 分支，个别用例覆盖 platform / env / productName。 */
function context(overrides = {}) {
  return { productName: 'TokensHarness', statePath: STATE_PATH, platform: 'win32', env: WIN_ENV, ...overrides }
}

test('152 productDataDirectory places Windows state under the roaming application data directory', () => {
  assert.equal(productDataDirectory('TokensHarness', 'win32', WIN_ENV), join(WIN_ENV.APPDATA, 'TokensHarness'))
})

test('153 productDataDirectory falls back to the standard roaming path when APPDATA is unusable', () => {
  const expected = join(homedir(), 'AppData', 'Roaming', 'TokensHarness')
  for (const env of [{}, { APPDATA: '' }, { APPDATA: '   ' }, { APPDATA: 42 }]) {
    assert.equal(productDataDirectory('TokensHarness', 'win32', env), expected, JSON.stringify(env))
  }
})

test('154 productDataDirectory follows the macOS and XDG conventions on other platforms', () => {
  assert.equal(
    productDataDirectory('TokensHarness', 'darwin', {}),
    join(homedir(), 'Library', 'Application Support', 'TokensHarness'),
  )
  assert.equal(productDataDirectory('TokensHarness', 'linux', {}), join(homedir(), '.config', 'TokensHarness'))
  assert.equal(
    productDataDirectory('TokensHarness', 'linux', { XDG_CONFIG_HOME: '/xdg' }),
    join('/xdg', 'TokensHarness'),
  )
})

test('155 productDataDirectory refuses a product name that cannot be one directory segment', () => {
  // 产品名来自配置，可能被写成任意字符串；它绝不能越出应用数据目录。
  for (const name of ['a/b', 'a\\b', 'C:', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', '.', '..', '...', '', '   ', 42, null, undefined]) {
    assert.equal(productDataDirectory(name, 'win32', WIN_ENV), null, String(name))
  }
})

test('156 resolveDownloadDirectory defaults to the product application data directory', () => {
  assert.equal(
    resolveDownloadDirectory('', context(), '0.2.0'),
    join(WIN_ENV.APPDATA, 'TokensHarness', 'updates', '0.2.0'),
  )
})

test('157 the default location follows the product name rather than the host application', () => {
  // 宿主的 statePath 仍指向 DSH Desktop，默认位置必须不再跟随它。
  const resolved = resolveDownloadDirectory('', context(), '0.2.0')
  assert.ok(!resolved.includes('DSH Desktop'), `installers must leave the host directory: ${resolved}`)
  assert.equal(
    resolveDownloadDirectory('', context({ productName: 'Other Brand' }), '0.2.0'),
    join(WIN_ENV.APPDATA, 'Other Brand', 'updates', '0.2.0'),
  )
})

test('158 resolveDownloadDirectory falls back beside the state file when the product name is unusable', () => {
  for (const productName of ['..', 'a/b', '', 42]) {
    assert.equal(resolveDownloadDirectory('', context({ productName }), '0.2.0'), STATE_SIBLING, String(productName))
  }
})

test('159 resolveDownloadDirectory appends the version to a configured absolute directory', () => {
  assert.equal(resolveDownloadDirectory(ABSOLUTE_TARGET, context(), '0.2.0'), join(ABSOLUTE_TARGET, '0.2.0'))
})

test('160 resolveDownloadDirectory expands a leading tilde to the home directory', () => {
  assert.equal(resolveDownloadDirectory('~', context(), '0.2.0'), join(homedir(), '0.2.0'))
  assert.equal(resolveDownloadDirectory('~/Downloads', context(), '0.2.0'), join(homedir(), 'Downloads', '0.2.0'))
})

test('161 resolveDownloadDirectory trims surrounding whitespace before deciding', () => {
  const target = join(ABSOLUTE_TARGET, '0.2.0')
  assert.equal(resolveDownloadDirectory(`  ${ABSOLUTE_TARGET}  `, context(), '0.2.0'), target)
  assert.equal(
    resolveDownloadDirectory('   ', context(), '0.2.0'),
    join(WIN_ENV.APPDATA, 'TokensHarness', 'updates', '0.2.0'),
  )
})

test('162 resolveDownloadDirectory falls back for relative and unusable configuration', () => {
  const fallback = join(WIN_ENV.APPDATA, 'TokensHarness', 'updates', '0.2.0')
  // 相对路径的基准是进程 cwd，桌面端不可预期，写到那里等于把安装包丢在未知位置。
  for (const configured of ['./installers', 'installers', '../installers', '~user/x', undefined, null, 42, {}]) {
    assert.equal(resolveDownloadDirectory(configured, context(), '0.2.0'), fallback, String(configured))
  }
})

test('163 every resolved directory ends in the version so releases cannot overwrite each other', () => {
  const cases = ['', ABSOLUTE_TARGET, '~', './relative', '   ']
  for (const configured of cases) {
    const first = resolveDownloadDirectory(configured, context(), '0.2.0')
    const second = resolveDownloadDirectory(configured, context(), '0.3.0')
    assert.notEqual(first, second, String(configured))
    assert.ok(first.endsWith(`${sep}0.2.0`), first)
    assert.ok(second.endsWith(`${sep}0.3.0`), second)
  }
})

test('164 a configured absolute downloadDirectory receives the installer', {
  skip: SUPPORTED_HOST ? false : 'unsupported host platform',
}, async () => {
  const root = await tempDir('dir-abs')
  const target = await tempDir('dir-target')
  try {
    const payload = Buffer.from('verified-installer-bytes')
    const asset = downloadableRelease('0.2.0', payload)
    const host = harness({
      root,
      confirm: true,
      request: async (url) => isReleaseMetadataRequest(url)
        ? release({
          tag_name: 'v0.2.0',
          assets: [{
            name: asset.name,
            browser_download_url: `https://github.com/o/r/releases/download/v0.2.0/${asset.name}`,
            size: asset.size,
            digest: asset.digest,
          }],
        })
        : new Response(payload),
    })
    const { tray, dispose } = host.start({ downloadDirectory: target })
    await tray.invoke()
    const settled = await waitForState(join(target, '0.2.0', asset.name), () => true)
    await dispose()
    assert.equal(settled, payload.toString('utf8'))
    assert.deepEqual(await readdir(root), ['state.json'], 'nothing may land beside the state file')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(target, { recursive: true, force: true })
  }
})

test('165 a relative downloadDirectory writes to the default location, never the process cwd', {
  skip: SUPPORTED_HOST ? false : 'unsupported host platform',
}, async () => {
  const root = await tempDir('dir-rel')
  // 将默认位置引到一个专用产品名下，以便断言后清理干净。
  const productName = 'DvuRelativeFallbackProbe'
  const productRoot = productDataDirectory(productName)
  try {
    const payload = Buffer.from('verified-installer-bytes')
    const asset = downloadableRelease('0.2.0', payload)
    const host = harness({
      root,
      confirm: true,
      request: async (url) => isReleaseMetadataRequest(url)
        ? release({
          tag_name: 'v0.2.0',
          assets: [{
            name: asset.name,
            browser_download_url: `https://github.com/o/r/releases/download/v0.2.0/${asset.name}`,
            size: asset.size,
            digest: asset.digest,
          }],
        })
        : new Response(payload),
    })
    const { tray, dispose } = host.start({ productName, downloadDirectory: './installers' })
    await tray.invoke()
    const settled = await waitForState(join(productRoot, 'updates', '0.2.0', asset.name), () => true)
    await dispose()
    assert.equal(settled, payload.toString('utf8'))
    assert.equal(existsSync(join(process.cwd(), 'installers')), false, 'the plugin must never write into its own cwd')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(productRoot, { recursive: true, force: true })
  }
})

test('166 Config exposes downloadDirectory and defaults it to the empty string', () => {
  assert.equal(Config({}).downloadDirectory, '')
  assert.equal(Config({ downloadDirectory: '/srv/installers' }).downloadDirectory, '/srv/installers')
  assert.throws(() => Config({ downloadDirectory: 42 }))
})

test('167 downloadInstaller reports monotonic byte progress through completion', async () => {
  const root = await tempDir('progress')
  try {
    const chunks = ['alpha', 'beta', 'gamma'].map(value => Buffer.from(value))
    const payload = Buffer.concat(chunks)
    const seen = []
    await downloadInstaller({
      asset: { name: 'progress.exe', url: 'https://github.com/x', size: payload.byteLength, digest: null },
      url: 'https://github.com/x',
      request: async () => new Response(new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk))
          controller.close()
        },
      })),
      directory: root,
      onProgress: progress => { seen.push(progress) },
    })
    assert.deepEqual(seen[0], { downloadedBytes: 0, totalBytes: payload.byteLength })
    assert.deepEqual(seen.at(-1), { downloadedBytes: payload.byteLength, totalBytes: payload.byteLength })
    for (let index = 1; index < seen.length; index += 1) {
      assert.ok(seen[index].downloadedBytes >= seen[index - 1].downloadedBytes)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('168 client RPC exposes an available update and starts its download without another confirmation', {
  skip: SUPPORTED_HOST ? false : 'unsupported host platform',
}, async (t) => {
  mockInstallerLaunch(t)
  const root = await tempDir('client-rpc')
  try {
    const payload = Buffer.from('client-download-bytes')
    const asset = downloadableRelease('0.2.0', payload)
    let openGate
    const gate = new Promise(resolve => { openGate = resolve })
    const host = harness({
      root,
      connection: true,
      confirm: false,
      request: async (url) => {
        if (isReleaseMetadataRequest(url)) {
          return release({
            tag_name: 'v0.2.0',
            assets: [{
              name: asset.name,
              browser_download_url: `https://github.com/o/r/releases/download/v0.2.0/${asset.name}`,
              size: asset.size,
              digest: asset.digest,
            }],
          })
        }
        await gate
        return new Response(payload)
      },
    })
    const { tray, rpc, dispose } = host.start()
    await tray.invoke()
    assert.deepEqual(await rpc('status'), {
      ok: true,
      value: { phase: 'available', productName: 'TokensHarness', version: '0.2.0' },
    })

    const pending = rpc('download')
    let downloading
    for (let attempt = 0; attempt < 100; attempt += 1) {
      downloading = await rpc('status')
      if (downloading.value?.phase === 'downloading') break
      await new Promise(resolve => { setTimeout(resolve, 10) })
    }
    assert.equal(downloading.value.phase, 'downloading')
    assert.equal(downloading.value.totalBytes, payload.byteLength)
    assert.deepEqual(host.log.confirmed, ['0.2.0'], 'the sidebar button is already an explicit confirmation')

    openGate()
    assert.deepEqual(await pending, { ok: true, value: { started: true } })
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('169 Desktop top button and tray share one manual update task', async () => {
  const root = await tempDir('desktop-route')
  try {
    let releaseRequestCount = 0
    let releaseRequestStarted
    let finishReleaseRequest
    const started = new Promise(resolve => { releaseRequestStarted = resolve })
    const gate = new Promise(resolve => { finishReleaseRequest = resolve })
    const host = harness({
      root,
      request: async () => {
        releaseRequestCount += 1
        releaseRequestStarted()
        await gate
        return release({ tag_name: 'v0.1.0' })
      },
    })
    const { tray, updateRoute, dispose } = host.start()
    assert.equal(updateRoute().path, DESKTOP_UPDATE_CHECK_PATH)
    assert.equal(updateRoute().kind, 'exact')

    const response = desktopUpdateResponse()
    const fromTopButton = updateRoute().handler(desktopUpdateRequest(), response)
    await started
    const fromTray = tray.invoke()
    finishReleaseRequest()
    await Promise.all([fromTopButton, fromTray])

    assert.equal(releaseRequestCount, 1)
    assert.equal(response.statusCode, 200)
    assert.deepEqual(JSON.parse(response.body), { accepted: true })
    assert.equal(host.log.manual.length, 1)
    await dispose()
    assert.equal(updateRoute(), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('170 Desktop update route rejects untrusted and non-empty requests', async () => {
  const root = await tempDir('desktop-route-guard')
  try {
    const host = harness({ root })
    const { updateRoute, dispose } = host.start()

    const crossOrigin = desktopUpdateResponse()
    await updateRoute().handler(desktopUpdateRequest({}, {
      headers: { origin: 'https://example.com' },
    }), crossOrigin)
    assert.equal(crossOrigin.statusCode, 403)

    const nonEmpty = desktopUpdateResponse()
    await updateRoute().handler(desktopUpdateRequest({ version: '9.9.9' }), nonEmpty)
    assert.equal(nonEmpty.statusCode, 400)
    assert.equal(host.log.requests.length, 0)
    await dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

}

// Plugin assertions; CSV maps observable cases to these test names.
async function registerPluginTests() {








function releaseResponse(version) {
  return Response.json({
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
  })
}

test('checks the public TokensHarness release index by default', async () => {
  const calls = []
  const result = await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async (url, init) => {
      calls.push({ url, init })
      return Response.json([
        { tag_name: 'v9.0.0', draft: true, prerelease: false },
        { tag_name: 'v0.3.0-rc.1', draft: false, prerelease: true },
        { tag_name: 'v0.1.9', draft: false, prerelease: false },
        { tag_name: 'v0.2.0', draft: false, prerelease: false },
      ])
    },
  })

  assert.deepEqual(result, {
    status: 'update-available',
    currentVersion: '0.1.0',
    latestVersion: '0.2.0',
    assets: [],
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, RELEASE_INDEX_ENDPOINT)
  assert.equal(new Headers(calls[0].init.headers).get('user-agent'), 'TokensHarness')
})


test('falls back to the GitHub latest Release API when the index is unavailable', async () => {
  const calls = []
  const result = await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async (url) => {
      calls.push(url)
      return url === RELEASE_INDEX_ENDPOINT
        ? new Response('{}', { status: 503 })
        : releaseResponse('0.2.0')
    },
  })

  assert.equal(result?.latestVersion, '0.2.0')
  assert.deepEqual(calls, [RELEASE_INDEX_ENDPOINT, RELEASE_ENDPOINT])
})

test('identity constants stay aligned with static manifests', async () => {
  const { readFile } = await import('node:fs/promises')
  const { PACKAGE_NAME, PLUGIN_NAME } = await import('../identity.js')
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.equal(manifest.name, PACKAGE_NAME)
  assert.ok(patch.includes(`name: '${PACKAGE_NAME}'`))
  assert.equal((await import('../index.js')).name, PLUGIN_NAME)
})

test('config overrides product name and release source URLs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-version-updates-cfg-'))
  const requested = []
  let tray, disposer
  const ctx = {
    desktopRuntime: {
      updates: {
        isPackaged: false,
        canDownload: true,
        currentVersion: '0.1.0',
        statePath: join(root, 'state.json'),
        request: async (url, init) => {
          requested.push({ url, agent: new Headers(init.headers).get('user-agent') })
          return url === 'https://updates.example.test/releases.json'
            ? new Response('{}', { status: 503 })
            : releaseResponse('0.2.0')
        },
        async confirmDownload() { return false },
        async showManualCheckResult() {},
        async downloadAndOpen() {},
      },
      registerTrayItem(item) { tray = item; return { refresh() {}, dispose() {} } },
    },
    webServer: {
      port: 43120,
      register() { return () => {} },
    },
    effect(register) { disposer = register() },
  }

  try {
    apply(ctx, Config({
      enabled: false,
      productName: 'MyBrand',
      githubOwner: 'my-org',
      githubRepo: 'my_repo',
      releaseIndexURL: 'https://updates.example.test/releases.json',
      releaseAPIURL: 'https://fallback.example.test/releases/latest',
    }))
    await tray.invoke()
    assert.deepEqual(requested.map(item => item.url), [
      'https://updates.example.test/releases.json',
      'https://fallback.example.test/releases/latest',
    ])
    assert.equal(requested[0].agent, 'MyBrand')
    assert.equal(tray.label(), 'MyBrand 0.2.0 Available')
    await disposer()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

const releaseAuditHeaders = {
  accept: 'application/vnd.github+json',
  'user-agent': 'tokens-dsh-version-updates-release-audit',
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
}

test('package metadata and actual tarball include the complete runtime without local artifacts', async () => {
  const root = new URL('../', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@tokens/dsh-version-updates')
  assert.equal(manifest.repository.url, 'git+https://github.com/sobermh/tokens_DshVersionUpdates_code.git')
  assert.equal(manifest.publishConfig.registry, 'https://npm.tokensapi.ai/')
  for (const field of ['displayName', 'summary']) {
    assert.ok(manifest.tokenscowork[field]['zh-CN'].trim())
    assert.ok(manifest.tokenscowork[field]['en-US'].trim())
    assert.notEqual(manifest.tokenscowork[field]['zh-CN'], manifest.tokenscowork[field]['en-US'])
  }
  const directory = await mkdtemp(join(tmpdir(), 'version-updates-pack-'))
  try {
    const command = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'npm'
    const args = ['pack', '--json', '--ignore-scripts', '--pack-destination', directory]
    const execution = spawnSync(command, process.platform === 'win32' ? ['/d', '/s', '/c', 'npm', ...args] : args, {
      cwd: root, encoding: 'utf8', timeout: 60_000,
    })
    assert.equal(execution.status, 0, execution.stderr)
    const [packed] = JSON.parse(execution.stdout)
    const files = packed.files.map(file => file.path)
    for (const required of ['index.js', 'download.js', 'identity.js', 'messages.js', 'index.d.ts', 'dist/client.js', 'cordis.patch.yml', 'package.json', 'LICENSE']) {
      assert.ok(files.includes(required), `missing packaged runtime file: ${required}`)
    }
    assert.equal(files.some(file => /^(?:test|src|node_modules|\.github)\/|\.partial$|\.env/u.test(file)), false)
    const artifact = join(directory, packed.filename)
    for (const required of ['index.js', 'download.js', 'messages.js', 'dist/client.js']) {
      const extracted = spawnSync('tar', ['-xOf', artifact, `package/${required}`], { encoding: 'utf8' })
      assert.equal(extracted.status, 0, extracted.stderr)
      assert.equal(extracted.stdout, await readFile(new URL(required, root), 'utf8'))
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

const releaseAudit = loadReleaseAudit()

test('live Pages index matches its GitHub stable Release', async () => {
  const { indexedRelease, githubRelease } = await releaseAudit
  assert.equal(indexedRelease.tag_name, githubRelease.tag_name)
  assert.equal(indexedRelease.target_commitish, githubRelease.target_commitish)
  assert.equal(indexedRelease.draft, false)
  assert.equal(indexedRelease.prerelease, false)
  assert.equal(githubRelease.draft, false)
  assert.equal(githubRelease.prerelease, false)
})

test('live stable Release publishes all branded installers with digests', async () => {
  const { githubRelease } = await releaseAudit
  const version = githubRelease.tag_name.slice(1)
  const assets = new Map(githubRelease.assets.map(asset => [asset.name, asset]))
  for (const suffix of [
    'windows-amd64-installer.exe',
    'macos-arm64-installer.dmg',
    'macos-amd64-installer.dmg',
  ]) {
    const name = `TokensCowork-${version}-${suffix}`
    const asset = assets.get(name)
    assert.ok(asset, `missing ${name}`)
    assert.ok(asset.size > 0, `${name} is empty`)
    assert.match(asset.digest ?? '', /^sha256:[0-9a-f]{64}$/u)
    assert.match(asset.browser_download_url, /^https:\/\/github\.com\/TokensAPI\/TokensCowork\/releases\/download\//u)
  }
  assert.equal(
    githubRelease.assets.some(asset => /DeepSeek|DSH.Desktop/iu.test(asset.name)),
    false,
    'stable release contains an upstream installer',
  )
})


async function loadReleaseAudit() {
  const index = await fetchJSON(RELEASE_INDEX_ENDPOINT)
  assert.ok(Array.isArray(index), 'Pages release index is not an array')
  const stable = index
    .filter(release => release?.draft === false
      && release?.prerelease === false
      && parseSemVer(release.tag_name)?.prerelease.length === 0)
    .sort((left, right) => compareSemVerVersions(right.tag_name, left.tag_name))[0]
  assert.ok(stable, 'Pages release index contains no stable release')
  const repositoryMatch = /^(https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+)\/releases\/\d+$/u.exec(stable.url ?? '')
  assert.ok(repositoryMatch, 'Pages stable release has an invalid GitHub API URL')

  const githubRelease = await fetchJSON(stable.url)
  return { indexedRelease: stable, githubRelease }
}

async function fetchJSON(url) {
  const response = await fetch(url, {
    headers: releaseAuditHeaders,
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    throw new Error(`${url} returned HTTP ${response.status}; rate-limit remaining=${remaining ?? 'unknown'}`)
  }
  return response.json()
}

}

// Publishing assertions; CSV maps observable cases to these test names.
async function registerPublishingTests() {












const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tag = `v${manifest.version}`;

test('publishing rejects wrong identity, registry, version and metadata', () => {
  assert.equal(validateRelease(manifest, tag), manifest.version);
  for (const edit of [
    m => { m.name = '@other/package'; }, m => { m.private = true; },
    m => { m.repository.url = `git+https://github.com.evil.test/${RELEASE_REPOSITORY}.git`; },
    m => { m.repository.url = `git+https://github.com/${RELEASE_REPOSITORY}-other.git`; },
    m => { m.publishConfig.registry = 'https://registry.npmjs.org/'; },
    m => { m.publishConfig.access = 'public'; }, m => { m.version += '-rc.1'; },
    m => { m.tokenscowork.summary['en-US'] = m.tokenscowork.summary['zh-CN']; },
  ]) {
    const candidate = structuredClone(manifest); edit(candidate);
    assert.throws(() => validateRelease(candidate, tag));
  }
  assert.throws(() => validateRelease(manifest, `v${manifest.version}0`), /tag/);
});

test('registry refuses existing versions, query failures and wrong credentials', async () => {
  const invoke = (status, username = 'tokenscowork') => registryRelease('check', {
    manifest, token: 'test-only', fetchImpl: async url => url.endsWith('/-/whoami')
      ? Response.json({ username }) : new Response(null, { status }),
  });
  await invoke(404);
  await assert.rejects(invoke(200), /already published/);
  for (const status of [202, 401, 403, 429, 500]) await assert.rejects(invoke(status), /absence is not confirmed/);
  await assert.rejects(invoke(404, 'someone-else'), /tokenscowork/);
  await assert.rejects(registryRelease('check', { manifest }), /VERDACCIO_PUBLISH_TOKEN/);
  await assert.rejects(registryRelease('check', { manifest, token: 'test-only', fetchImpl: async () => { throw new Error('network failure'); } }), /network failure/);
});

test('registry verifies exact package, integrity and latest after publishing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'release-integrity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = join(root, 'package.tgz');
  const data = Buffer.from('test tarball bytes'); await writeFile(filename, data);
  const metadata = { name: manifest.name, version: manifest.version,
    dist: { integrity: `sha512-${createHash('sha512').update(data).digest('base64')}` } };
  const invoke = value => registryRelease('verify', { manifest, token: 'test-only', filename,
    fetchImpl: async url => Response.json(url.endsWith('/-/whoami') ? { username: 'tokenscowork' } : value) });
  await invoke(metadata);
  await assert.rejects(invoke({ ...metadata, name: 'other' }), /identity/);
  await assert.rejects(invoke({ ...metadata, dist: { integrity: 'wrong' } }), /integrity/);
  await assert.rejects(registryRelease('verify', { manifest, token: 'test-only', filename,
    fetchImpl: async url => url.endsWith('/-/whoami') ? Response.json({ username: 'tokenscowork' }) : new Response(null, { status: 503 }),
  }), /verification failed/);
  let queries = 0;
  await registryRelease('verify', { manifest, token: 'test-only', filename,
    fetchImpl: async url => {
      if (url.endsWith('/-/whoami')) return Response.json({ username: 'tokenscowork' });
      return ++queries === 1 ? new Response(null, { status: 202 }) : Response.json(metadata);
    },
  });
  assert.equal(queries, 3, 'Processing response must be queried again before declaring success');
  let pendingQueries = 0;
  await assert.rejects(registryRelease('verify', { manifest, token: 'test-only', filename,
    fetchImpl: async url => {
      if (url.endsWith('/-/whoami')) return Response.json({ username: 'tokenscowork' });
      pendingQueries++;
      return new Response(null, { status: 202 });
    },
  }), /not yet verified; do not publish again/);
  assert.equal(pendingQueries, 3, 'Pending verification must have a bounded retry count');
});

test('tarball rejects missing runtime files and unexpected private files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'release-tar-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'package'));
  const files = ['package.json', 'index.js', 'identity.js', 'download.js', 'messages.js',
    'index.d.ts', 'dist/client.js', 'cordis.patch.yml', 'README.md', 'LICENSE'];
  for (const file of files) {
    await mkdir(join(root, 'package', file, '..'), { recursive: true });
    await writeFile(join(root, 'package', file), await readFile(new URL(`../${file}`, import.meta.url)));
  }
  const filename = join(root, 'test.tgz');
  await tar.c({ cwd: root, file: filename, gzip: true }, ['package']);
  await verifyTarball(filename, manifest);
  await writeFile(join(root, 'package', '.npmrc'), 'secret-placeholder');
  await tar.c({ cwd: root, file: filename, gzip: true }, ['package']);
  await assert.rejects(verifyTarball(filename, manifest), /exactly/);
  await rm(join(root, 'package', '.npmrc'));
  await rm(join(root, 'package', 'messages.js'));
  await tar.c({ cwd: root, file: filename, gzip: true }, ['package']);
  await assert.rejects(verifyTarball(filename, manifest), /exactly/);
});

test('workflow parses and gates automatic and manual publication on checks', async () => {
  const source = await readFile(new URL('../.github/workflows/publish-npm.yml', import.meta.url), 'utf8');
  const document = parseDocument(source, { uniqueKeys: true });
  assert.deepEqual(document.errors, []);
  const workflow = document.toJS();
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.deepEqual(workflow.on.push.tags, ['v*']);
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.match(workflow.concurrency.group, /inputs.release_tag.*github.ref_name/);
  assert.deepEqual(workflow.jobs.publish.needs, ['resolve', 'check']);
  assert.match(workflow.jobs.publish.if, /sobermh\/tokens_DshVersionUpdates_code/);
  assert.match(workflow.jobs.publish.if, /inputs.publish/);
  assert.match(workflow.jobs.publish.if, /refs\/tags\/v/);
  assert.deepEqual(workflow.jobs.check.strategy.matrix.node, ['22.19.0', '24', '26']);
  assert.ok(workflow.jobs.resolve.steps.some(s => s.run?.includes('refs/tags/$tag^{commit}')));
  const publishSteps = workflow.jobs.publish.steps;
  const credentialSteps = publishSteps.filter(s => s.env?.NODE_AUTH_TOKEN);
  assert.equal(credentialSteps.length, 1);
  assert.match(credentialSteps[0].run, /registry-release.mjs check[\s\S]*npm publish[\s\S]*registry-release.mjs verify/);
  assert.match(credentialSteps[0].run, /--ignore-scripts --registry=https:\/\/npm.tokensapi.ai\//);
  assert.equal(publishSteps.find(s => s.uses?.startsWith('actions/setup-node')).with['registry-url'], 'https://npm.tokensapi.ai/');
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.uses?.startsWith('actions/checkout')) assert.equal(step.with['persist-credentials'], false);
      if (step.run?.includes('npm pack')) assert.match(step.run, /npm pack --ignore-scripts/);
    }
  }
  assert.ok(workflow.jobs.check.steps.some(s => s.run === 'npm run check'));
  assert.ok(workflow.jobs.check.steps.some(s => s.with?.path === '.test-host/desktop'));
});

}
