import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  Config,
  RELEASE_ENDPOINT,
  RELEASE_INDEX_ENDPOINT,
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
    webServer: {
      port: 43120,
      register() { return () => {} },
    },
    effect(register) {
      disposer = register()
    },
  }

  try {
    apply(ctx, Config({ enabled: false }))
    assert.equal(tray.label(), 'Check Updates…')
    await tray.invoke()
    assert.deepEqual(manualResults, [{
      status: 'up-to-date',
      currentVersion: '0.1.0',
      latestVersion: '0.1.0',
      assets: [],
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

test('selects the platform-matching installer asset', async () => {
  const { selectInstallerAsset } = await import('../download.js')
  const assets = [
    { name: 'TokensHarness-0.2.0-macos-arm64-installer.dmg', url: 'https://github.com/a', size: 1, digest: null },
    { name: 'TokensHarness-0.2.0-windows-amd64-installer.exe', url: 'https://github.com/b', size: 1, digest: null },
    { name: 'TokensHarness-0.2.0-SHA256SUMS.txt', url: 'https://github.com/c', size: 1, digest: null },
  ]
  assert.equal(selectInstallerAsset(assets, 'win32', 'x64')?.name, 'TokensHarness-0.2.0-windows-amd64-installer.exe')
  assert.equal(selectInstallerAsset(assets, 'darwin', 'arm64')?.name, 'TokensHarness-0.2.0-macos-arm64-installer.dmg')
  assert.equal(selectInstallerAsset(assets, 'darwin', 'x64'), null)
  assert.equal(selectInstallerAsset(assets, 'linux', 'x64'), null)
})

test('downloads, verifies, and rejects installers by SHA-256', async () => {
  const { downloadInstaller } = await import('../download.js')
  const { createHash } = await import('node:crypto')
  const { readFile } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'dsh-version-updates-dl-'))
  const payload = Buffer.from('installer-bytes')
  const digest = `sha256:${createHash('sha256').update(payload).digest('hex')}`

  try {
    const good = await downloadInstaller({
      asset: { name: 'a.exe', url: 'https://github.com/x', size: payload.byteLength, digest },
      url: 'https://github.com/x',
      request: async () => new Response(payload),
      directory: root,
    })
    assert.deepEqual(await readFile(good), payload)

    await assert.rejects(
      downloadInstaller({
        asset: { name: 'b.exe', url: 'https://github.com/x', size: payload.byteLength, digest },
        url: 'https://github.com/x',
        request: async () => new Response(Buffer.from('tampered-bytes!')),
        directory: root,
      }),
      /digest mismatch|declared size/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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
