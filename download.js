/** TokensHarness 安装包的资产选择、下载校验与安装器移交。 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/* ====================================================================
 * 常量
 * 安装包体积上限与各平台/架构对应的 Release 资产文件名模式。
 * ==================================================================== */

/** Maximum accepted installer size, in bytes. */
export const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024

const ASSET_PATTERNS = {
  'win32:x64': /-windows-amd64-installer\.exe$/u,
  'darwin:arm64': /-macos-arm64-installer\.dmg$/u,
  'darwin:x64': /-macos-amd64-installer\.dmg$/u,
}

/* ====================================================================
 * 资产选择（导出）
 * 从 GitHub Release 的 assets 中挑出当前平台/架构的安装包。
 * ==================================================================== */

/**
 * Select the installer asset matching one platform and CPU architecture.
 * @param {ReadonlyArray<import('./index.d.ts').ReleaseAsset>} assets Release installer assets.
 * @param {string} [platform] Node platform identifier; defaults to the current process.
 * @param {string} [arch] Node architecture identifier; defaults to the current process.
 * @returns {import('./index.d.ts').ReleaseAsset | null} The matching asset, or null.
 */
export function selectInstallerAsset(assets, platform = process.platform, arch = process.arch) {
  const pattern = ASSET_PATTERNS[`${platform}:${arch}`]
  if (pattern === undefined) return null
  return assets.find(asset => pattern.test(asset.name)) ?? null
}

/* ====================================================================
 * 已下载安装包的复用校验（导出）
 * 目标文件已存在且 Release 声明了摘要时，重算一遍 SHA-256 而不是
 * 重新下载整个安装包；摘要缺失、体积不符或校验失败都返回 false，
 * 由调用方照常走网络。
 * ==================================================================== */

/**
 * Verify one already-downloaded installer against its declared digest.
 * @param {string} path Absolute path of the candidate installer.
 * @param {import('./index.d.ts').ReleaseAsset} asset Release asset describing it.
 * @returns {Promise<boolean>} True when the file is present and trustworthy.
 */
export async function verifyDownloadedInstaller(path, asset) {
  // 摘要非法时不在此处失败关闭：交回下载路径，由 downloadInstaller 抛出唯一的诊断。
  let declaredDigest
  try {
    declaredDigest = parseSha256Digest(asset.digest)
  } catch {
    return false
  }
  if (declaredDigest === null) return false

  let stats
  try {
    stats = await stat(path)
  } catch {
    return false
  }
  if (!stats.isFile()) return false
  if (typeof asset.size === 'number' && asset.size > 0 && stats.size !== asset.size) return false
  if (stats.size === 0 || stats.size > MAX_INSTALLER_BYTES) return false

  let handle
  try {
    handle = await open(path, 'r')
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let position = 0
    while (position < stats.size) {
      const read = await handle.read(buffer, 0, buffer.byteLength, position)
      if (read.bytesRead === 0) return false
      position += read.bytesRead
      hash.update(buffer.subarray(0, read.bytesRead))
    }
    return hash.digest('hex') === declaredDigest
  } catch {
    return false
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/* ====================================================================
 * 下载与校验（导出）
 * 流式写入临时文件并同步计算 SHA-256，与 Release 声明的摘要比对，
 * 校验通过才改名为最终文件；任何失败都清理临时文件后抛出。
 * ==================================================================== */

/**
 * Download one installer asset and verify its declared SHA-256 digest.
 * @param {object} options Download inputs.
 * @param {import('./index.d.ts').ReleaseAsset} options.asset Selected release asset.
 * @param {string} options.url Download URL (the asset URL, or a mirror override).
 * @param {import('./index.d.ts').UpdateRequest} options.request Fetch implementation.
 * @param {string} options.directory Private destination directory.
 * @param {AbortSignal} [options.signal] Caller-owned cancellation signal.
 * @returns {Promise<string>} Absolute path of the verified installer.
 * @throws When the response fails, exceeds limits, or the digest mismatches.
 */
export async function downloadInstaller(options) {
  const { asset, url, request, directory, signal } = options
  const declaredDigest = parseSha256Digest(asset.digest)
  const sizeLimit = typeof asset.size === 'number' && asset.size > 0 && asset.size <= MAX_INSTALLER_BYTES
    ? asset.size
    : MAX_INSTALLER_BYTES

  await mkdir(directory, { recursive: true, mode: 0o700 })
  const finalPath = join(directory, asset.name)
  const temporary = join(directory, `.${asset.name}.${process.pid}.partial`)

  const response = await request(url, {
    method: 'GET',
    cache: 'no-store',
    redirect: 'follow',
    ...(signal === undefined ? {} : { signal }),
  })
  if (response.status !== 200) {
    throw new Error(`installer download returned HTTP ${String(response.status)}`)
  }
  if (response.body === null) throw new Error('installer download returned an empty body')

  const hash = createHash('sha256')
  const handle = await open(temporary, 'wx', 0o600)
  const reader = response.body.getReader()
  let bytesWritten = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      bytesWritten += chunk.value.byteLength
      if (bytesWritten > sizeLimit) throw new Error('installer download exceeds the declared size')
      hash.update(chunk.value)
      await handle.write(chunk.value)
    }
    if (bytesWritten === 0) throw new Error('installer download returned an empty body')
    await handle.sync()
    const actualDigest = hash.digest('hex')
    if (declaredDigest !== null && actualDigest !== declaredDigest) {
      throw new Error('installer digest mismatch')
    }
    await handle.close()
    await unlink(finalPath).catch(() => undefined)
    await rename(temporary, finalPath)
    return finalPath
  } catch (cause) {
    await reader.cancel().catch(() => undefined)
    await handle.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw cause
  } finally {
    reader.releaseLock()
  }
}

/* ====================================================================
 * 安装器移交（导出）
 * 以分离子进程打开下载完成的安装器：Windows 直接运行 NSIS 安装器，
 * macOS 交给系统打开 DMG。应用内下载的文件不带隔离属性，未签名
 * 场景也可直接打开。
 * ==================================================================== */

/**
 * Open one verified installer through the platform's native flow.
 * @param {string} path Absolute installer path.
 * @param {string} [platform] Node platform identifier; defaults to the current process.
 */
export function openInstaller(path, platform = process.platform) {
  const command = platform === 'darwin' ? 'open' : path
  const args = platform === 'darwin' ? [path] : []
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {
    // 安装器启动失败不致命：文件已下载完成，用户仍可手动运行。
  })
  child.unref()
}

/* ====================================================================
 * 内部辅助函数
 * ==================================================================== */

function parseSha256Digest(digest) {
  if (digest === null || digest === undefined) return null
  if (typeof digest !== 'string') throw new Error('installer digest is invalid')
  const match = /^sha256:([0-9a-f]{64})$/iu.exec(digest)
  if (match === null) throw new Error('installer digest is invalid')
  return match[1].toLowerCase()
}
