/** TokensHarness GitHub Release discovery and tray update plugin. */

import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import Schema from '@deepseek-ai/schemastery'
import {
  downloadInstaller,
  openInstaller,
  selectInstallerAsset,
  verifyDownloadedInstaller,
} from './download.js'
import {
  DOWNLOAD_BASE_URL,
  DOWNLOAD_DIRECTORY,
  GITHUB_OWNER,
  GITHUB_REPO,
  INITIAL_DELAY_MS,
  INTERVAL_MS,
  PACKAGE_NAME,
  PLUGIN_NAME,
  PRODUCT_NAME,
  RELEASE_ENDPOINT,
  REQUEST_TIMEOUT_MS,
  UPDATES_ENABLED,
} from './identity.js'

export { RELEASE_ENDPOINT }
export {
  selectInstallerAsset,
  downloadInstaller,
  openInstaller,
  verifyDownloadedInstaller,
  MAX_INSTALLER_BYTES,
} from './download.js'

/* ====================================================================
 * 插件标识与配置
 * Cordis 插件名、依赖注入声明、GitHub Release 端点与响应上限，
 * 以及后台轮询策略的 Schema（enabled、初始延迟、间隔、请求超时）。
 * ==================================================================== */

/** Stable Cordis plugin name. */
export const name = PLUGIN_NAME

/** Native adapter required for network, tray, confirmation, and installer access. */
export const inject = ['desktopRuntime']

/** Maximum response body bytes accepted from GitHub's release document. */
export const MAX_VERSION_RESPONSE_BYTES = 256 * 1024

const MAX_TIMER_DELAY_MS = 2_147_483_647
const MAX_STATE_BYTES = 4 * 1024
const EMPTY_STATE = { version: 2 }
const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

/** Validated scheduled update policy. */
// 每个字段的默认值集中定义在 identity.js，用户可经 profile 补丁按需覆盖。
export const Config = Schema.object({
  enabled: Schema.boolean().default(UPDATES_ENABLED),
  initialDelayMs: Schema.number().step(1).min(0).max(MAX_TIMER_DELAY_MS).default(INITIAL_DELAY_MS),
  intervalMs: Schema.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(INTERVAL_MS),
  requestTimeoutMs: Schema.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(REQUEST_TIMEOUT_MS),
  downloadBaseURL: Schema.string().default(DOWNLOAD_BASE_URL),
  downloadDirectory: Schema.string().default(DOWNLOAD_DIRECTORY),
  productName: Schema.string().default(PRODUCT_NAME),
  githubOwner: Schema.string().default(GITHUB_OWNER),
  githubRepo: Schema.string().default(GITHUB_REPO),
})

/* ====================================================================
 * SemVer 解析与比较（导出）
 * 严格的 Semantic Versioning 解析和无溢出精度比较，
 * 供本插件与测试使用；数值段保留字符串形式避免大数溢出。
 * ==================================================================== */

/**
 * Parse strict Semantic Versioning with an optional lowercase `v` prefix.
 * @param {string} input Complete version or release tag.
 * @returns {import('./index.js').ParsedSemVer | null} Parsed identifiers, or null.
 */
export function parseSemVer(input) {
  const version = input.startsWith('v') ? input.slice(1) : input
  const match = SEMVER_PATTERN.exec(version)
  if (match === null) return null

  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(identifier => isNumeric(identifier) && hasLeadingZero(identifier))) return null

  return {
    version,
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease,
    build: match[5]?.split('.') ?? [],
  }
}

/**
 * Compare two strict Semantic Versioning strings without numeric overflow.
 * @param {string} left First version.
 * @param {string} right Second version.
 * @returns {number | null} Negative, zero, positive, or null for invalid input.
 */
export function compareSemVerVersions(left, right) {
  const leftVersion = parseSemVer(left)
  const rightVersion = parseSemVer(right)
  if (leftVersion === null || rightVersion === null) return null
  return compareParsedSemVer(leftVersion, rightVersion)
}

/* ====================================================================
 * 版本检查（导出）
 * 请求 GitHub latest Release 并与当前版本比较；任何请求、解析或
 * 校验失败都返回 null，不向调用方抛出。
 * ==================================================================== */

/**
 * Check the TokensHarness GitHub repository for a newer stable Release.
 * @param {{ currentVersion: string, signal?: AbortSignal, request?: import('./index.js').UpdateRequest, endpoint?: string, userAgent?: string }} options Check inputs.
 * @returns {Promise<import('./index.js').UpdateCheckResult | null>} Comparison or null on failure.
 */
export async function checkForStableUpdate(options) {
  const current = parseCanonicalStableVersion(options.currentVersion)
  if (current === null) return null

  const init = {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': options.userAgent ?? PRODUCT_NAME,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
    redirect: 'error',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  const request = options.request ?? globalThis.fetch

  let response
  try {
    response = await request(options.endpoint ?? RELEASE_ENDPOINT, init)
  } catch {
    return null
  }
  if (response.status !== 200) return null

  let body
  try {
    body = await readLimitedBody(response)
  } catch {
    return null
  }

  const parsed = parseVersionResponse(body)
  if (parsed === null) return null
  return {
    status: compareParsedSemVer(parsed.latest, current) > 0 ? 'update-available' : 'up-to-date',
    currentVersion: current.version,
    latestVersion: parsed.latest.version,
    assets: parsed.assets,
  }
}

/* ====================================================================
 * 手动检查结果文案（导出）
 * 三种结果各对应一个弹窗规格：请求失败、有新版但本构建无法自动
 * 下载、已是最新。抽成纯函数以便脱离 Electron 直接断言文案。
 * ==================================================================== */

/**
 * Describe the dialog shown after one manual update check.
 * @param {import('./index.d.ts').UpdateCheckResult | null} result Check outcome, or null on failure.
 * @param {{ productName: string, releasesPageURL: string }} options Branding and manual download target.
 * @returns {{ type: string, title: string, message: string, detail: string }} Dialog specification.
 */
export function describeManualCheck(result, options) {
  const { productName, releasesPageURL } = options
  if (result === null) {
    return {
      type: 'warning',
      title: 'Unable to Check for Updates',
      message: `${productName} could not check for updates.`,
      detail: 'Please try again later.',
    }
  }
  if (result.status === 'update-available') {
    return {
      type: 'info',
      title: `${productName} Update Available`,
      message: `${productName} ${result.latestVersion} is available.`,
      detail: 'This build cannot install updates automatically. Download it manually:'
        + `\n\n${releasesPageURL}`,
    }
  }
  return {
    type: 'info',
    title: `${productName} Is Up to Date`,
    message: `No newer version of ${productName} is available.`,
    detail: `Installed version: ${result.currentVersion}`,
  }
}

/* ====================================================================
 * 下载目录解析（导出）
 * 把配置里的目录字符串归一化成安装包的落盘目录。只接受绝对路径
 * 与 `~` 开头的家目录写法，其余一律回退到状态文件旁；两条分支
 * 都再按版本号建子目录。抽成纯函数以便直接断言路径策略。
 * ==================================================================== */

/**
 * Resolve the directory that receives one version's installer.
 * @param {unknown} configured Configured directory; empty, relative, or non-string falls back.
 * @param {string} statePath Update state file path, source of the default location.
 * @param {string} version Stable version whose subdirectory is appended.
 * @returns {string} Directory ending in the version segment.
 */
export function resolveDownloadDirectory(configured, statePath, version) {
  const fallback = join(dirname(statePath), version)
  if (typeof configured !== 'string') return fallback
  const trimmed = configured.trim()
  if (trimmed === '') return fallback
  // `~` 与 `~/x` 展开到家目录；`~user` 这类形式不解释，按无效处理。
  const expanded = trimmed === '~'
    ? homedir()
    : /^~[/\\]/u.test(trimmed) ? join(homedir(), trimmed.slice(2)) : trimmed
  // 相对路径的基准取决于进程 cwd，桌面端不可预期，故一律回退到默认目录。
  return isAbsolute(expanded) ? join(expanded, version) : fallback
}

/* ====================================================================
 * 插件主体
 * 在一个 effect 作用域内组合全部运行态：提示状态持久化、去重的
 * 版本检查、确认后的下载与安装包移交、手动与后台两条触发路径、
 * 托盘菜单项，以及卸载时的计时器清理与请求中止。
 * ==================================================================== */

/**
 * Register effect-scoped update polling and its dynamic tray command.
 * @param {ContextWithDesktopRuntime} ctx Host context carrying the desktop adapter.
 * @param {{ enabled: boolean, initialDelayMs: number, intervalMs: number, requestTimeoutMs: number }} config Policy.
 */
export function apply(ctx, config) {
  const adapter = ctx.desktopRuntime.updates
  const productName = config.productName ?? PRODUCT_NAME
  const releaseEndpoint = `https://api.github.com/repos/${config.githubOwner ?? GITHUB_OWNER}/${config.githubRepo ?? GITHUB_REPO}/releases/latest`
  const releasesPageURL = `https://github.com/${config.githubOwner ?? GITHUB_OWNER}/${config.githubRepo ?? GITHUB_REPO}/releases/latest`
  ctx.effect(() => {
    let disposed = false
    let checking = false
    let availableVersion
    let availableAssets = []
    let downloadingVersion
    let state = EMPTY_STATE
    let pollTimer
    let requestTimer
    let requestController
    let downloadController
    let inFlight
    let manualTask
    let downloadTask
    let refreshTray = () => {}

    /* --------------------- 提示状态读写与去重 --------------------- */
    const persistState = async () => {
      try {
        await writeFileAtomic(adapter.statePath, renderState(state), {
          mode: 0o600,
          dirMode: 0o700,
        })
      } catch {
        // Prompt history is optional and must never affect application startup.
      }
    }

    const stateReady = (async () => {
      try {
        state = parseState(await readState(adapter.statePath))
      } catch (cause) {
        if (isEnoent(cause)) return
        state = EMPTY_STATE
        if (!disposed) await persistState()
      }
    })()

    const rememberPrompt = async (version) => {
      await stateReady
      if (state.lastPromptedVersion === version) return
      state = { version: 2, lastPromptedVersion: version }
      await persistState()
    }

    /* ----------------------- 单飞的版本检查 ----------------------- */
    const startCheck = () => {
      if (inFlight !== undefined) return inFlight
      checking = true
      refreshTray()
      const controller = new AbortController()
      requestController = controller

      const task = (async () => {
        requestTimer = setTimeout(() => { controller.abort() }, config.requestTimeoutMs)
        try {
          return await checkForStableUpdate({
            currentVersion: adapter.currentVersion,
            signal: controller.signal,
            request: adapter.request,
            endpoint: releaseEndpoint,
            userAgent: productName,
          })
        } catch {
          return null
        }
      })().finally(() => {
        if (requestTimer !== undefined) clearTimeout(requestTimer)
        requestTimer = undefined
        if (requestController === controller) requestController = undefined
        inFlight = undefined
        checking = false
        refreshTray()
      })
      inFlight = task
      return task
    }

    const observeResult = (result) => {
      if (disposed || result === null) return undefined
      availableVersion = result.status === 'update-available' && adapter.canDownload
        ? result.latestVersion
        : undefined
      availableAssets = availableVersion === undefined ? [] : result.assets ?? []
      refreshTray()
      return availableVersion
    }

    /* ---------------- 品牌确认弹窗（无 Electron 时回退） ---------------- */
    const confirmDownload = async (version) => {
      const electron = await loadElectron()
      if (electron === null) return adapter.confirmDownload(version)
      const result = await electron.dialog.showMessageBox({
        type: 'info',
        title: `${productName} Update Available`,
        message: `${productName} ${version} is available.`,
        detail: 'Download this update now?',
        buttons: ['Download', 'Later'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      return result.response === 0
    }

    const announceReady = async (version, path) => {
      const electron = await loadElectron()
      if (electron === null) return
      await electron.dialog.showMessageBox({
        type: 'info',
        title: `${productName} Update Downloaded`,
        message: `${productName} ${version} is ready to install.`,
        detail: process.platform === 'darwin'
          ? `The disk image has opened. Replace ${productName} in Applications, then reopen it.`
          : `The installer has started. Follow it to update ${productName}.\n\n${path}`,
        buttons: ['OK'],
        defaultId: 0,
        noLink: true,
      })
    }

    const showManualCheckResult = async (result) => {
      const electron = await loadElectron()
      if (electron === null) return adapter.showManualCheckResult(result)
      await electron.dialog.showMessageBox({
        ...describeManualCheck(result, { productName, releasesPageURL }),
        buttons: ['OK'],
        defaultId: 0,
        noLink: true,
      })
    }

    /* ------------------- 确认下载与安装包移交 ------------------- */
    const startDownload = (version) => {
      if (downloadTask !== undefined) return downloadTask
      const task = (async () => {
        let confirmed
        try {
          confirmed = await confirmDownload(version)
        } catch {
          return
        }
        if (!confirmed || disposed) return

        const confirmedVersion = observeResult(await startCheck())
        if (confirmedVersion !== version || disposed) return

        const asset = selectInstallerAsset(availableAssets)
        if (asset === null) return

        const controller = new AbortController()
        downloadController = controller
        downloadingVersion = version
        refreshTray()
        try {
          const directory = resolveDownloadDirectory(config.downloadDirectory, adapter.statePath, version)
          const existing = join(directory, asset.name)
          // 同名安装包已在磁盘且摘要吻合时复用，避免重复拉取整个安装包。
          const path = await verifyDownloadedInstaller(existing, asset)
            ? existing
            : await downloadInstaller({
              asset,
              url: rewriteDownloadURL(asset.url, config.downloadBaseURL),
              request: adapter.request,
              directory,
              signal: controller.signal,
            })
          controller.signal.throwIfAborted()
          openInstaller(path)
          await announceReady(version, path)
        } catch {
          // Download, filesystem, and installer handoff failures stay silent.
        } finally {
          if (downloadController === controller) downloadController = undefined
          downloadingVersion = undefined
          refreshTray()
        }
      })().finally(() => {
        if (downloadTask === task) downloadTask = undefined
      })
      downloadTask = task
      return task
    }

    const offerDownload = async (version, automatic) => {
      if (disposed || !adapter.canDownload) return
      await stateReady
      if (disposed || (automatic && state.lastPromptedVersion === version)) return
      await rememberPrompt(version)
      if (!disposed) await startDownload(version)
    }

    /* ------------------- 手动与后台两条触发路径 ------------------- */
    const runManualCheck = () => {
      manualTask ??= (async () => {
        if (availableVersion !== undefined) {
          await offerDownload(availableVersion, false)
          return
        }
        const result = await startCheck()
        if (disposed) return
        const version = observeResult(result)
        if (version !== undefined) {
          await offerDownload(version, false)
          return
        }
        await showManualCheckResult(result)
      })().catch(() => undefined).finally(() => { manualTask = undefined })
      return manualTask
    }

    const runBackgroundCheck = async () => {
      if (inFlight !== undefined || disposed) return
      try {
        const version = observeResult(await startCheck())
        if (version !== undefined) await offerDownload(version, true)
      } catch {
        // Scheduled checks never surface failures to the user or application log.
      }
    }

    const scheduleBackgroundCheck = (delayMs) => {
      pollTimer = setTimeout(() => {
        pollTimer = undefined
        void runBackgroundCheck().finally(() => {
          if (!disposed) scheduleBackgroundCheck(config.intervalMs)
        })
      }, delayMs)
    }

    /* ------------------- 托盘注册、启动与卸载 ------------------- */
    const registration = ctx.desktopRuntime.registerTrayItem({
      group: 'status',
      order: 10,
      label: () => downloadingVersion === undefined
        ? availableVersion === undefined
          ? checking ? 'Checking for Updates…' : 'Check for Updates…'
          : `${productName} ${availableVersion} Available`
        : `Downloading ${productName} ${downloadingVersion}…`,
      invoke: runManualCheck,
    })
    refreshTray = registration.refresh

    if (adapter.isPackaged && config.enabled) scheduleBackgroundCheck(config.initialDelayMs)

    return async () => {
      disposed = true
      if (pollTimer !== undefined) clearTimeout(pollTimer)
      if (requestTimer !== undefined) clearTimeout(requestTimer)
      requestController?.abort()
      downloadController?.abort()
      registration.dispose()
      const pending = [stateReady]
      if (inFlight !== undefined) pending.push(inFlight)
      await Promise.allSettled(pending)
    }
  }, `${PACKAGE_NAME}: polling and installer handoff`)
}

/* ====================================================================
 * 内部辅助函数
 * 限长响应读取、Release 文档与提示状态的严格解析、SemVer 内部
 * 比较原语。均不导出；新增仅本文件使用的逻辑放在本区。
 * ==================================================================== */

async function readLimitedBody(response) {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null
    && /^[0-9]+$/u.test(declaredLength)
    && BigInt(declaredLength) > BigInt(MAX_VERSION_RESPONSE_BYTES)) {
    throw new Error('release response is too large')
  }

  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytesRead = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytesRead += chunk.value.byteLength
      if (bytesRead > MAX_VERSION_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('release response is too large')
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function parseVersionResponse(body) {
  let value
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (!isRecord(value)
    || value.draft !== false
    || value.prerelease !== false
    || typeof value.tag_name !== 'string'
    || !value.tag_name.startsWith('v')) return null
  const latest = parseCanonicalStableVersion(value.tag_name.slice(1))
  if (latest === null) return null
  return { latest, assets: parseReleaseAssets(value.assets) }
}

function parseReleaseAssets(value) {
  if (!Array.isArray(value)) return []
  const assets = []
  for (const item of value) {
    if (!isRecord(item)
      || typeof item.name !== 'string'
      || typeof item.browser_download_url !== 'string'
      || !item.browser_download_url.startsWith('https://')) continue
    assets.push({
      name: item.name,
      url: item.browser_download_url,
      size: typeof item.size === 'number' ? item.size : 0,
      digest: typeof item.digest === 'string' ? item.digest : null,
    })
  }
  return assets
}

function parseCanonicalStableVersion(input) {
  const parsed = parseSemVer(input)
  return parsed !== null && parsed.prerelease.length === 0 && parsed.version === input
    ? parsed
    : null
}

function compareParsedSemVer(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    const comparison = compareNumeric(left[key], right[key])
    if (comparison !== 0) return comparison
  }
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1
  if (right.prerelease.length === 0) return -1

  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftNumeric = isNumeric(leftIdentifier)
    const rightNumeric = isNumeric(rightIdentifier)
    if (leftNumeric && rightNumeric) return compareNumeric(leftIdentifier, rightIdentifier)
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

function compareNumeric(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function isNumeric(identifier) {
  return /^[0-9]+$/u.test(identifier)
}

function hasLeadingZero(identifier) {
  return identifier.length > 1 && identifier.startsWith('0')
}

let electronModule
async function loadElectron() {
  if (electronModule !== undefined) return electronModule
  try {
    const value = await import('electron')
    electronModule = typeof value.dialog?.showMessageBox === 'function' ? value : null
  } catch {
    electronModule = null
  }
  return electronModule
}

function rewriteDownloadURL(url, baseURL) {
  const prefix = typeof baseURL === 'string' ? baseURL.trim().replace(/\/+$/u, '') : ''
  if (prefix === '' || !prefix.startsWith('https://')) return url
  return url.replace(/^https:\/\/github\.com/u, prefix)
}

function parseState(text) {
  const value = JSON.parse(text)
  if (!isRecord(value)
    || value.version !== 2
    || (value.lastPromptedVersion !== undefined && !isStableVersion(value.lastPromptedVersion))
    || Object.keys(value).some(key => !['version', 'lastPromptedVersion'].includes(key))) {
    throw new Error('invalid v2 update state')
  }
  return value.lastPromptedVersion === undefined
    ? EMPTY_STATE
    : { version: 2, lastPromptedVersion: value.lastPromptedVersion }
}

async function readState(filename) {
  const handle = await open(filename, 'r')
  try {
    const buffer = Buffer.alloc(MAX_STATE_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
    if (bytesRead > MAX_STATE_BYTES) throw new Error(`update state exceeds ${MAX_STATE_BYTES} bytes`)
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

function renderState(state) {
  return `${JSON.stringify(state, null, 2)}\n`
}

function isStableVersion(value) {
  if (typeof value !== 'string') return false
  const parsed = parseSemVer(value)
  return parsed !== null && parsed.prerelease.length === 0 && parsed.version === value
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEnoent(value) {
  return isRecord(value) && value.code === 'ENOENT'
}

/** @typedef {import('./index.d.ts').ParsedSemVer} ParsedSemVer */
/** @typedef {import('./index.d.ts').UpdateRequest} UpdateRequest */
/** @typedef {import('./index.d.ts').UpdateCheckResult} UpdateCheckResult */
/** @typedef {import('./index.d.ts').UpdatePluginContext} ContextWithDesktopRuntime */
