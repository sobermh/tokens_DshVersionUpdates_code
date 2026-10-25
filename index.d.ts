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
  /** Raw Release body of the version the dialogs will name; empty when none was available. */
  readonly notes: string
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
  /** HTTPS Release index override; empty derives the GitHub Pages URL from githubOwner/githubRepo. */
  releaseIndexURL?: string
  /** HTTPS fallback API override; empty derives the GitHub API URL from githubOwner/githubRepo. */
  releaseAPIURL?: string
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
  readonly locale?: string
  readonly updates: UpdateAdapter
  registerTrayItem(item: UpdateTrayItem): UpdateTrayItemRegistration
}

/** Exact private route registered on the Desktop loopback server. */
export interface UpdateWebRoute {
  readonly kind: 'exact'
  readonly path: string
  readonly handler: (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => void | Promise<void>
}

/** Minimal loopback WebServer surface consumed by this plugin. */
export interface UpdateWebServer {
  readonly port: number
  register(route: UpdateWebRoute): () => void
}

/** Minimal Cordis-compatible Host context required by this plugin. */
export interface UpdatePluginContext {
  readonly desktopRuntime: UpdateDesktopRuntime
  readonly webServer: UpdateWebServer
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
export const inject: readonly ['desktopRuntime', 'webServer']
export const Config: ConfigSchema
export const RELEASE_ENDPOINT: string
export const RELEASE_INDEX_ENDPOINT: string
export const DESKTOP_UPDATE_CHECK_PATH: '/api/desktop/updates/check'
export const MAX_VERSION_RESPONSE_BYTES: number

export function parseSemVer(input: string): ParsedSemVer | null
export function compareSemVerVersions(left: string, right: string): number | null
export function handleDesktopUpdateCheckRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  expectedOrigin: string,
  checkNow: () => Promise<void>,
): Promise<void>
export function checkForStableUpdate(options: {
  currentVersion: string
  signal?: AbortSignal
  request?: UpdateRequest
  endpoint?: string
  fallbackEndpoint?: string
  userAgent?: string
  /** Resolves one version's own Release endpoint, used only when the document lacks it. */
  notesEndpointFor?: (version: string) => string | null | undefined
}): Promise<UpdateCheckResult | null>
/** One native dialog, ready to pass to Electron's showMessageBox. */
export interface UpdateDialog {
  readonly type: 'info' | 'warning'
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly buttons: readonly string[]
  readonly defaultId: number
  readonly cancelId: number
  readonly noLink: true
  /** Index of the button opening the full release notes, or -1 when there are none. */
  readonly notesButtonId: number
  /** Release page that button opens; empty when there is no such button. */
  readonly notesURL: string
}
export function describeManualCheck(
  result: UpdateCheckResult | null,
  options: { productName: string, releasesPageURL: string, locale?: string },
): UpdateDialog
export function describeDownloadPrompt(
  version: string,
  releaseNotes: unknown,
  options: { productName: string, releasesPageURL: string, locale?: string },
): UpdateDialog
export function releaseTagPageURL(releasesPageURL: string, version: string): string
export function releaseNotesEndpoint(endpoint: string, version: string): string | null
export function presentUpdateDialog(
  spec: UpdateDialog,
  native: {
    showMessageBox: (options: Record<string, unknown>) => Promise<{ response: number }>
    openExternal?: (url: string) => Promise<unknown>
  },
): Promise<number>

/** Plain-text summary and highlights extracted from one Release body. */
export interface ReleaseNotesSummary {
  readonly summary: string
  readonly highlights: readonly string[]
}
export const MAX_RELEASE_HIGHLIGHTS: number
export const MAX_RELEASE_NOTES_CHARACTERS: number
export function selectReleaseNotesLanguage(body: unknown, locale?: string): string
export function summarizeReleaseNotes(body: unknown, locale?: string): ReleaseNotesSummary
export function renderReleaseNotes(body: unknown, locale?: string): string

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
export function openInstaller(path: string, platform?: string): Promise<void>
export function verifyDownloadedInstaller(
  path: string,
  asset: ReleaseAsset,
): Promise<boolean>
