import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  Config,
  RELEASE_ENDPOINT,
  apply,
  checkForStableUpdate,
  compareSemVerVersions,
  parseSemVer,
} from '../index.js'

function releaseResponse(version) {
  return Response.json({
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
  })
}

test('parses and compares strict versions', () => {
  assert.equal(parseSemVer('v0.1.0')?.version, '0.1.0')
  assert.equal(parseSemVer('0.1'), null)
  assert.equal(compareSemVerVersions('0.2.0', '0.1.9'), 1)
})

test('checks only the public TokensHarness latest Release', async () => {
  const calls = []
  const result = await checkForStableUpdate({
    currentVersion: '0.1.0',
    request: async (url, init) => {
      calls.push({ url, init })
      return releaseResponse('0.2.0')
    },
  })

  assert.deepEqual(result, {
    status: 'update-available',
    currentVersion: '0.1.0',
    latestVersion: '0.2.0',
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, RELEASE_ENDPOINT)
  assert.equal(new Headers(calls[0].init.headers).get('user-agent'), 'TokensHarness')
})

test('registers one manual update tray command through desktopRuntime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-version-updates-'))
  let tray
  let disposer
  const manualResults = []
  const registration = { refresh() {}, dispose() {} }
  const ctx = {
    desktopRuntime: {
      updates: {
        isPackaged: false,
        canDownload: true,
        currentVersion: '0.1.0',
        statePath: join(root, 'state.json'),
        request: async () => releaseResponse('0.1.0'),
        async confirmDownload() { return false },
        async showManualCheckResult(result) { manualResults.push(result) },
        async downloadAndOpen() {},
      },
      registerTrayItem(item) {
        tray = item
        return registration
      },
    },
    effect(register) {
      disposer = register()
    },
  }

  try {
    apply(ctx, Config({ enabled: false }))
    assert.equal(tray.label(), 'Check for Updates…')
    await tray.invoke()
    assert.deepEqual(manualResults, [{
      status: 'up-to-date',
      currentVersion: '0.1.0',
      latestVersion: '0.1.0',
    }])
    await disposer()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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
