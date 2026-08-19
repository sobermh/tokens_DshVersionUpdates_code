import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { IconDownloadOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { installStyles } from './styles.ts'

const UPDATE_RPC_CHANNEL = '/tokens-version-updates'
const IDLE_POLL_MS = 2_000
const ACTIVE_POLL_MS = 250

type UpdateStatus =
  | { phase: 'idle'; productName: string }
  | { phase: 'checking'; productName: string }
  | { phase: 'available'; productName: string; version: string }
  | {
    phase: 'downloading'
    productName: string
    version: string
    downloadedBytes: number
    totalBytes: number
  }

interface UpdateActionFace {
  readStatus(): Promise<UpdateStatus>
  download(): Promise<boolean>
}

type UpdateActionProps = PropsRuntime<'sidebar.footer.action'> & InjectFace<UpdateActionFace>

function percentage(status: Extract<UpdateStatus, { phase: 'downloading' }>): number | undefined {
  if (status.totalBytes <= 0) return undefined
  return Math.max(0, Math.min(100, Math.floor(status.downloadedBytes / status.totalBytes * 100)))
}

function chineseUI(): boolean {
  const language = document.documentElement.lang || navigator.language
  return language.toLowerCase().startsWith('zh')
}

/** Sidebar download action shown only while an update is actionable. */
function UpdateAction({ wide, readStatus, download }: UpdateActionProps) {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [starting, setStarting] = useState(false)

  const refresh = useCallback(async (): Promise<UpdateStatus | null> => {
    try {
      const next = await readStatus()
      setStatus(next)
      return next
    } catch {
      setStatus(null)
      return null
    }
  }, [readStatus])

  useEffect(() => {
    let live = true
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      const next = await refresh()
      if (!live) return
      timer = window.setTimeout(
        () => { void poll() },
        next?.phase === 'downloading' ? ACTIVE_POLL_MS : IDLE_POLL_MS,
      )
    }
    void poll()
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [refresh])

  if (status === null || status.phase === 'idle' || status.phase === 'checking') return null

  const zh = chineseUI()
  const downloading = status.phase === 'downloading'
  const progress = downloading ? percentage(status) : undefined
  const availableLabel = zh ? `下载 ${status.version}` : `Download ${status.version}`
  const progressLabel = zh
    ? `正在下载 ${progress === undefined ? '' : `${progress}%`}`.trim()
    : `Downloading ${progress === undefined ? '' : `${progress}%`}`.trim()
  const label = downloading ? progressLabel : availableLabel
  const tooltip = `${label} · ${status.productName}`
  const ringStyle = {
    '--tokens-update-progress': `${progress ?? 0}%`,
  } as CSSProperties

  return (
    <div className={`tokensVersionUpdateRoot${wide ? ' tokensVersionUpdateWide' : ''}`}>
      <Tooltip label={tooltip} side="right" delayMs={400} disabled={wide}>
        <button
          type="button"
          className="tokensVersionUpdateButton"
          aria-label={tooltip}
          aria-live="polite"
          disabled={downloading || starting}
          data-downloading={downloading || undefined}
          onClick={() => {
            if (downloading || starting) return
            setStarting(true)
            void download().catch(() => false).finally(() => {
              setStarting(false)
              void refresh()
            })
          }}
        >
          <span
            className={`tokensVersionUpdateIcon${progress === undefined && downloading ? ' tokensVersionUpdateIndeterminate' : ''}`}
            style={ringStyle}
          >
            <IconDownloadOutline16 size={wide ? 16 : 18} />
          </span>
          {wide && <span className="tokensVersionUpdateLabel">{starting && !downloading ? progressLabel : label}</span>}
          {wide && downloading && (
            <span className="tokensVersionUpdateTrack" aria-hidden>
              <span style={{ width: `${progress ?? 12}%` }} />
            </span>
          )}
        </button>
      </Tooltip>
    </div>
  )
}

export const inject = ['slots', 'connection']

/** Mount the update action into the sidebar footer supplied by ui-sidebar. */
export function apply(ctx: ClientContext): void {
  ctx.effect(installStyles, 'tokens-version-updates: sidebar styles')
  const connection = ctx.get('connection') as ConnectionHandle

  const call = async <T,>(endpoint: string): Promise<T> => {
    const result = await connection.rpc.call(UPDATE_RPC_CHANNEL, endpoint, {})
    if (!result.ok) throw new Error(result.error.message)
    return result.value as T
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'tokens-version-updates',
    order: 10,
    inject: (): UpdateActionFace => ({
      readStatus: () => call<UpdateStatus>('status'),
      download: async () => (await call<{ started: boolean }>('download')).started,
    }),
  }, UpdateAction))
}
