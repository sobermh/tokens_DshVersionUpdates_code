/** Fetch-compatible request function used by the release checker. */
export type UpdateRequest = (url: string, init: RequestInit) => Promise<Response>

/** One installer artifact published on the latest stable GitHub Release. */
export interface ReleaseAsset {
  readonly name: string
  readonly url: string
  readonly size: number
  readonly digest: string | null
}

/** Successful comparison returned by the latest stable GitHub Release. */
export interface UpdateCheckResult {
  readonly status: 'up-to-date' | 'update-available'
  readonly currentVersion: string
  readonly latestVersion: string
  readonly assets: readonly ReleaseAsset[]
}

/** Strictly parsed Semantic Versioning components. */
export interface ParsedSemVer {
  readonly version: string
  readonly major: string
  readonly minor: string
  readonly patch: string
  readonly prerelease: readonly string[]
  readonly build: readonly string[]
}

/** Scheduled update policy. */
export interface Config {
  enabled: boolean
  initialDelayMs: number
  intervalMs: number
  requestTimeoutMs: number
  /** HTTPS mirror prefix replacing `https://github.com` in asset URLs; empty uses GitHub directly. */
  downloadBaseURL: string
  /** Absolute directory receiving `<version>/` installer subdirectories; empty uses `<productName>/updates/` in the platform application data directory. */
  downloadDirectory: string
  /** User-visible product name in dialogs and tray labels; defaults to identity.js. */
  productName: string
  /** GitHub owner of the release repository; defaults to identity.js. */
  githubOwner: string
  /** GitHub repository name of the release source; defaults to identity.js. */
  githubRepo: string
}

/** Callable configuration validator supplied by Schemastery. */
export interface ConfigSchema {
  (value?: Partial<Config>): Config
}

/** Native update adapter supplied by the TokensHarness desktop runtime. */
export interface UpdateAdapter {
  readonly isPackaged: boolean
  readonly canDownload: boolean
  readonly currentVersion: string
  readonly statePath: string
  readonly request: UpdateRequest
  confirmDownload(version: string): Promise<boolean>
  showManualCheckResult(result: UpdateCheckResult | null): Promise<void>
  downloadAndOpen(version: string, signal: AbortSignal): Promise<void>
}

/** Tray command contributed by the update plugin. */
export interface UpdateTrayItem {
  readonly group: 'status'
  readonly order: number
  label(): string
  invoke(): void | Promise<void>
}

/** Refreshable lifetime handle for the contributed tray command. */
export interface UpdateTrayItemRegistration {
  refresh(): void
  dispose(): void
}

/** Desktop runtime fields consumed by this independent plugin. */
export interface UpdateDesktopRuntime {
  readonly updates: UpdateAdapter
  registerTrayItem(item: UpdateTrayItem): UpdateTrayItemRegistration
}

/** Minimal Cordis-compatible Host context required by this plugin. */
export interface UpdatePluginContext {
  readonly desktopRuntime: UpdateDesktopRuntime
  inject?(
    services: readonly ['connection'],
    apply: (ctx: UpdatePluginContext & {
      readonly connection: {
        readonly rpc: {
          handle(
            channel: string,
            handler: (endpoint: string, payload: unknown) => Promise<unknown>,
            options: { authority: 'trusted-host' },
          ): () => void
        }
      }
    }) => void,
  ): void
  effect(
    execute: () => () => void | Promise<void>,
    label?: string,
  ): unknown
}

export const name: string
export const inject: readonly ['desktopRuntime']
export const Config: ConfigSchema
export const RELEASE_ENDPOINT: string
export const MAX_VERSION_RESPONSE_BYTES: number

export function parseSemVer(input: string): ParsedSemVer | null
export function compareSemVerVersions(left: string, right: string): number | null
export function checkForStableUpdate(options: {
  currentVersion: string
  signal?: AbortSignal
  request?: UpdateRequest
  endpoint?: string
  userAgent?: string
}): Promise<UpdateCheckResult | null>
export interface ManualCheckDialog {
  readonly type: 'info' | 'warning'
  readonly title: string
  readonly message: string
  readonly detail: string
}
export function describeManualCheck(
  result: UpdateCheckResult | null,
  options: { productName: string, releasesPageURL: string },
): ManualCheckDialog

/** Resolve the application data directory holding one product's own state, or null when the name cannot be a directory. */
export function productDataDirectory(
  productName: string,
  platform?: string,
  env?: Record<string, string | undefined>,
): string | null

/** Resolve the directory receiving one version's installer; empty, relative, or non-string configuration uses the product data directory. */
export function resolveDownloadDirectory(
  configured: unknown,
  context: {
    productName: string
    statePath: string
    platform?: string
    env?: Record<string, string | undefined>
  },
  version: string,
): string
export function apply(ctx: UpdatePluginContext, config: Config): void

export const MAX_INSTALLER_BYTES: number
export function selectInstallerAsset(
  assets: readonly ReleaseAsset[],
  platform?: string,
  arch?: string,
): ReleaseAsset | null
export function downloadInstaller(options: {
  asset: ReleaseAsset
  url: string
  request: UpdateRequest
  directory: string
  signal?: AbortSignal
  onProgress?: (progress: { downloadedBytes: number; totalBytes: number }) => void
}): Promise<string>
export function openInstaller(path: string, platform?: string): void
export function verifyDownloadedInstaller(
  path: string,
  asset: ReleaseAsset,
): Promise<boolean>
