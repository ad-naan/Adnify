import { useState } from 'react'
import { Info } from 'lucide-react'
import type { ToolCall } from '@renderer/agent/types'
import type { AssetKind } from '@shared/types/assets'
import { t, type TranslationKey } from '@shared/i18n'
import { useStore } from '@store'
import { useToolDisplayState } from '@renderer/agent/presentation/toolDisplay'
import { Modal } from '@components/ui'
import { AssetCanvas, AssetJobCard, AssetPlaceholder, AssetPreview, assetKindKeys } from './AssetJobCard'
import { ToolApprovalActions } from './ToolApprovalActions'
import { getToolTiming, ToolElapsedTime } from './ToolActivityIndicator'

interface Props {
  toolCall: ToolCall
  isPresenting?: boolean
  isAwaitingApproval?: boolean
  onApprove?: () => void
  onReject?: () => void
  onStop?: () => void
}
const labels: Record<string, TranslationKey> = {
  asset_capabilities: 'assets.assetCapabilities', asset_import: 'assets.importImage',
  asset_export: 'assets.export', asset_job_get: 'assets.job', asset_job_cancel: 'assets.cancelQueued',
}
function text(value: unknown): string | undefined { return typeof value === 'string' && value ? value : undefined }

export default function AssetToolCard({ toolCall, isPresenting, isAwaitingApproval, onApprove, onReject, onStop }: Props) {
  const language = useStore(state => state.language)
  const { effectiveName: name, args, isRunning, isStreaming, isError, isRejected, isSuccess } = useToolDisplayState(toolCall)
  const [details, setDetails] = useState(false)
  const meta = args._meta as Record<string, unknown> | undefined
  const timing = getToolTiming(toolCall)
  let result: Record<string, unknown> | undefined
  try { if (toolCall.result) result = JSON.parse(toolCall.result) } catch { /* Legacy errors can be plain text. */ }
  const jobId = text(meta?.assetJobId) || toolCall.richContent?.find(item => item.type === 'asset-job')?.jobId || text(args.job_id) || (result?.capabilityName ? text(result.id) : undefined)
  const kind = typeof meta?.assetKind === 'string' && meta.assetKind in assetKindKeys ? meta.assetKind as AssetKind : 'image'
  const title = text(meta?.assetName) || t(labels[name] || 'assets.generate', language)
  const assetId = name === 'asset_import' && isSuccess ? text(result?.id) : name === 'asset_export' && isSuccess ? text(args.asset_id) : undefined

  // Old transcripts may contain many wait calls. Their original generation card tracks the same job.
  if (name === 'asset_job_wait') return null
  if (jobId && !isAwaitingApproval) return <AssetJobCard key={jobId} jobId={jobId} title={title} kind={kind} prompt={text(args.prompt)} isPresenting={isPresenting} />
  if (assetId) return <AssetPreview id={assetId} automaticOpen={isPresenting} />

  const active = !isAwaitingApproval && (isRunning || isStreaming)
  const status = t(isAwaitingApproval ? 'assets.canvasApproval' : isRejected ? 'assets.cancelled' : isError ? 'assets.failed' : isSuccess ? 'assets.ready' : 'assets.preparing', language)
  const failure = isError ? toolCall.error || toolCall.result : undefined
  const capabilities = name === 'asset_capabilities' && Array.isArray(result?.capabilities) ? result.capabilities as Array<{ name: string; kind: AssetKind }> : undefined
  return <>
    <AssetCanvas automaticOpen={isAwaitingApproval || active ? true : isPresenting} title={title} collapsedLabel={text(args.prompt) || text(args.path)} kind={kind} trailing={<ToolElapsedTime state={active ? 'running' : 'idle'} {...timing} className="!text-text-muted" />} actions={<button onClick={() => setDetails(true)} title={t('assets.details', language)} aria-label={t('assets.details', language)} className="rounded p-1 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"><Info size={13} /></button>} footer={isAwaitingApproval ? <ToolApprovalActions language={language} onApprove={onApprove} onReject={onReject} onStop={onStop} /> : active && onStop ? <ToolApprovalActions language={language} onStop={onStop} /> : undefined}>
      {capabilities ? <div className="min-h-24 space-y-1 p-3">{capabilities.length ? capabilities.map((cap, index) => <div key={index} className="flex justify-between gap-3 px-1 py-1.5 text-text-secondary"><span className="truncate">{cap.name}</span><span className="text-text-muted">{t(assetKindKeys[cap.kind] || 'assets.file', language)}</span></div>) : <p className="py-4 text-text-muted">{t('assets.noToolsYet', language)}</p>}</div> : <AssetPlaceholder kind={kind} label={status} busy={active} error={failure}>
        {text(args.prompt) && <p className="line-clamp-3 max-w-full text-[11px] leading-5 text-text-muted [overflow-wrap:anywhere]">{text(args.prompt)}</p>}
      </AssetPlaceholder>}
    </AssetCanvas>
    <Modal isOpen={details} onClose={() => setDetails(false)} title={t('assets.details', language)} size="lg"><pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-text-secondary [overflow-wrap:anywhere]">{JSON.stringify(Object.fromEntries(Object.entries(args).filter(([key]) => key !== '_meta')), null, 2)}</pre></Modal>
  </>
}
