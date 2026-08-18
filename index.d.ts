/** Fetch-compatible request function used by the release checker. */
export type UpdateRequest = (url: string, init: RequestInit) => Promise<Response>

/** Successful comparison returned by the latest stable GitHub Release. */
export interface UpdateCheckResult {
  readonly status: 'up-to-date' | 'update-available'
  readonly currentVersion: string
  readonly latestVersion: string
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
  effect(
    execute: () => () => void | Promise<void>,
    label?: string,
  ): unknown
}

export const name: 'tokens-dsh-version-updates'
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
}): Promise<UpdateCheckResult | null>
export function apply(ctx: UpdatePluginContext, config: Config): void
