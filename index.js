/** TokensHarness GitHub Release discovery and tray update plugin. */

import { open } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import Schema from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name. */
export const name = 'desktop-updates'

/** Native adapter required for network, tray, confirmation, and installer access. */
export const inject = ['desktopRuntime']

/** Public GitHub API endpoint returning the latest stable TokensHarness release. */
export const RELEASE_ENDPOINT =
  'https://api.github.com/repos/sobermh/tokens_TokensHarness_code/releases/latest'

/** Maximum response body bytes accepted from GitHub's release document. */
export const MAX_VERSION_RESPONSE_BYTES = 256 * 1024

const MAX_TIMER_DELAY_MS = 2_147_483_647
const MAX_STATE_BYTES = 4 * 1024
const EMPTY_STATE = { version: 2 }
const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

/** Validated scheduled update policy. */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  initialDelayMs: Schema.number().step(1).min(0).max(MAX_TIMER_DELAY_MS).default(60_000),
  intervalMs: Schema.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(6 * 60 * 60 * 1000),
  requestTimeoutMs: Schema.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(15_000),
})

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

/**
 * Check the TokensHarness GitHub repository for a newer stable Release.
 * @param {{ currentVersion: string, signal?: AbortSignal, request?: import('./index.js').UpdateRequest }} options Check inputs.
 * @returns {Promise<import('./index.js').UpdateCheckResult | null>} Comparison or null on failure.
 */
export async function checkForStableUpdate(options) {
  const current = parseCanonicalStableVersion(options.currentVersion)
  if (current === null) return null

  const init = {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'TokensHarness',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
    redirect: 'error',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  const request = options.request ?? globalThis.fetch

  let response
  try {
    response = await request(RELEASE_ENDPOINT, init)
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

  const latest = parseVersionResponse(body)
  if (latest === null) return null
  return {
    status: compareParsedSemVer(latest, current) > 0 ? 'update-available' : 'up-to-date',
    currentVersion: current.version,
    latestVersion: latest.version,
  }
}

/**
 * Register effect-scoped update polling and its dynamic tray command.
 * @param {ContextWithDesktopRuntime} ctx Host context carrying the desktop adapter.
 * @param {{ enabled: boolean, initialDelayMs: number, intervalMs: number, requestTimeoutMs: number }} config Policy.
 */
export function apply(ctx, config) {
  const adapter = ctx.desktopRuntime.updates
  ctx.effect(() => {
    let disposed = false
    let checking = false
    let availableVersion
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
      refreshTray()
      return availableVersion
    }

    const startDownload = (version) => {
      if (downloadTask !== undefined) return downloadTask
      const task = (async () => {
        let confirmed
        try {
          confirmed = await adapter.confirmDownload(version)
        } catch {
          return
        }
        if (!confirmed || disposed) return

        const confirmedVersion = observeResult(await startCheck())
        if (confirmedVersion !== version || disposed) return

        const controller = new AbortController()
        downloadController = controller
        downloadingVersion = version
        refreshTray()
        try {
          await adapter.downloadAndOpen(version, controller.signal)
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
        await adapter.showManualCheckResult(result)
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

    const registration = ctx.desktopRuntime.registerTrayItem({
      group: 'status',
      order: 10,
      label: () => downloadingVersion === undefined
        ? availableVersion === undefined
          ? checking ? 'Checking for Updates…' : 'Check for Updates…'
          : `TokensHarness ${availableVersion} Available`
        : `Downloading TokensHarness ${downloadingVersion}…`,
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
  }, '@tokens/tokensharness-updates: polling and installer handoff')
}

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
  return parseCanonicalStableVersion(value.tag_name.slice(1))
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
