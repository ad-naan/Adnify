import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Download, FileText, Folder, FolderPlus, FolderUp, Pencil, RefreshCw, Save, SquareArrowOutUpRight, Trash2, Upload, Wifi, X } from 'lucide-react'
import { Button, Input, Modal } from '@/renderer/components/ui'
import { globalConfirm } from '@/renderer/components/common/ConfirmDialog'
import { toast } from '@/renderer/components/common/InlineToast'
import { api } from '@/renderer/services/electronAPI'
import { useStore } from '@store'
import { buildRemoteEditorPath } from '../services/remoteEditorService'
import type { RemoteFileEntry, RemoteServerConfig } from '../types'
import { t, type Language } from '@shared/i18n'

interface RemoteFileBrowserProps {
  server: RemoteServerConfig
  language: Language
  onClose?: () => void
}

interface NameDialogState {
  mode: 'create-folder' | 'create-file' | 'rename'
  value: string
  target?: RemoteFileEntry
}

function normalizePath(value?: string): string {
  const raw = (value || '.').trim()
  if (!raw) return '.'
  if (raw === '/') return '/'
  if (raw === '.') return '.'
  const absolute = raw.startsWith('/')
  const segments = raw.split('/').filter((segment) => segment && segment !== '.')
  const normalized: string[] = []
  for (const segment of segments) {
    if (segment === '..') {
      normalized.pop()
      continue
    }
    normalized.push(segment)
  }
  const joined = normalized.join('/')
  if (!joined) return absolute ? '/' : '.'
  return absolute ? `/${joined}` : joined
}

function joinPath(base: string, name: string): string {
  if (!base || base === '.') return normalizePath(name)
  if (base === '/') return `/${name}`
  return normalizePath(`${base}/${name}`)
}

function getParentPath(target: string): string {
  const normalized = normalizePath(target)
  if (normalized === '.' || normalized === '/') return normalized
  const parts = normalized.split('/').filter(Boolean)
  parts.pop()
  if (normalized.startsWith('/')) return parts.length ? `/${parts.join('/')}` : '/'
  return parts.length ? parts.join('/') : '.'
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function RemoteFileBrowser({ server, language, onClose }: RemoteFileBrowserProps) {
  const openEditorFile = useStore((state) => state.openFile)
  const [currentPath, setCurrentPath] = useState<string>(normalizePath(server.remotePath || '.'))
  const [entries, setEntries] = useState<RemoteFileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [selectedFilePath, setSelectedFilePath] = useState<string>('')
  const [selectedFileContent, setSelectedFileContent] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)

  const serverKey = useMemo(
    () => `${server.username || ''}@${server.host}:${server.port || 22}:${server.remotePath || ''}:${server.privateKeyPath || ''}:${server.password || ''}`,
    [server.host, server.password, server.port, server.privateKeyPath, server.remotePath, server.username],
  )

  const loadEntries = useCallback(async (targetPath = currentPath) => {
    if (!server.host.trim()) return
    setLoading(true)
    setError('')
    try {
      const result = await api.remoteShell.list(server, targetPath)
      setEntries(result)
      setCurrentPath(normalizePath(targetPath))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [currentPath, server])

  useEffect(() => {
    const initialPath = normalizePath(server.remotePath || '.')
    setCurrentPath(initialPath)
    setEntries([])
    setSelectedFilePath('')
    setSelectedFileContent('')
    setDirty(false)
    setNameDialog(null)
    if (server.host.trim()) {
      void loadEntries(initialPath)
    }
  }, [serverKey])

  const openEmbeddedFile = useCallback(async (filePath: string) => {
    try {
      const content = await api.remoteShell.readText(server, filePath)
      setSelectedFilePath(filePath)
      setSelectedFileContent(content || '')
      setDirty(false)
    } catch (readError) {
      toast.error(t('remoteFileBrowser.failedToOpenRemote', language), readError instanceof Error ? readError.message : String(readError))
    }
  }, [language, server])

  const openInEditor = useCallback(async (filePath: string) => {
    try {
      const content = await api.remoteShell.readText(server, filePath)
      if (!server.username) {
        throw new Error(t('remoteFileBrowser.missingRemoteUsername', language))
      }
      openEditorFile(buildRemoteEditorPath(server, filePath), content || '', undefined, {
        remote: {
          server: {
            host: server.host,
            port: server.port,
            username: server.username,
            password: server.password,
            privateKeyPath: server.privateKeyPath,
            remotePath: server.remotePath,
          },
          remotePath: filePath,
        },
      })
    } catch (readError) {
      toast.error(t('remoteFileBrowser.failedToOpenRemote', language), readError instanceof Error ? readError.message : String(readError))
    }
  }, [language, openEditorFile, server])

  const saveFile = useCallback(async () => {
    if (!selectedFilePath) return
    setSaving(true)
    try {
      await api.remoteShell.writeText(server, selectedFilePath, selectedFileContent)
      setDirty(false)
      toast.success(t('remoteFileBrowser.remoteFileSaved', language))
      await loadEntries(currentPath)
    } catch (saveError) {
      toast.error(t('remoteFileBrowser.failedToSaveRemote', language), saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }, [currentPath, language, loadEntries, selectedFileContent, selectedFilePath, server])

  const handleCreateFolder = useCallback(() => {
    setNameDialog({ mode: 'create-folder', value: '' })
  }, [])

  const handleCreateFile = useCallback(() => {
    setNameDialog({ mode: 'create-file', value: '' })
  }, [])

  const handleRename = useCallback((entry: RemoteFileEntry) => {
    setNameDialog({ mode: 'rename', value: entry.name, target: entry })
  }, [])

  const handleNameDialogConfirm = useCallback(async () => {
    if (!nameDialog) return
    const name = nameDialog.value.trim()
    if (!name) return

    try {
      if (nameDialog.mode === 'create-folder') {
        await api.remoteShell.mkdir(server, joinPath(currentPath, name))
        await loadEntries(currentPath)
      } else if (nameDialog.mode === 'create-file') {
        const filePath = joinPath(currentPath, name)
        await api.remoteShell.writeText(server, filePath, '')
        await loadEntries(currentPath)
        await openEmbeddedFile(filePath)
      } else if (nameDialog.target) {
        const nextPath = joinPath(getParentPath(nameDialog.target.path), name)
        if (nextPath !== nameDialog.target.path) {
          await api.remoteShell.rename(server, nameDialog.target.path, nextPath)
          if (selectedFilePath === nameDialog.target.path) setSelectedFilePath(nextPath)
          await loadEntries(currentPath)
        }
      }
      setNameDialog(null)
    } catch (dialogError) {
      const fallbackMessage =
        nameDialog.mode === 'create-folder'
          ? t('remoteFileBrowser.failedToCreateFolder', language)
          : nameDialog.mode === 'create-file'
            ? t('remoteFileBrowser.failedToCreateFile', language)
            : t('remoteFileBrowser.failedToRename', language)
      toast.error(fallbackMessage, dialogError instanceof Error ? dialogError.message : String(dialogError))
    }
  }, [currentPath, language, loadEntries, nameDialog, openEmbeddedFile, selectedFilePath, server])

  const handleDelete = useCallback(async (entry: RemoteFileEntry) => {
    const confirmed = await globalConfirm({
      title: t('remoteFileBrowser.deleteRemoteFile', language),
      message: t('remoteFileBrowser.delete', language, { name: entry.name }),
      confirmText: t('delete', language),
      variant: 'danger',
    })
    if (!confirmed) return
    try {
      await api.remoteShell.delete(server, entry.path)
      if (selectedFilePath === entry.path) {
        setSelectedFilePath('')
        setSelectedFileContent('')
        setDirty(false)
      }
      await loadEntries(currentPath)
    } catch (deleteError) {
      toast.error(t('remoteFileBrowser.failedToDelete', language), deleteError instanceof Error ? deleteError.message : String(deleteError))
    }
  }, [currentPath, language, loadEntries, selectedFilePath, server])

  const handleTestConnection = useCallback(async () => {
    setTesting(true)
    try {
      const result = await api.remoteShell.testConnection(server)
      if (result.success) toast.success(t('remoteFileBrowser.remoteConnectionSucceeded', language))
      else toast.error(t('remoteFileBrowser.remoteConnectionFailed', language), result.error)
    } finally {
      setTesting(false)
    }
  }, [language, server])

  const handleUpload = useCallback(async (mode: 'files' | 'directory' = 'files') => {
    if (uploading || downloading) return
    setUploading(true)
    try {
      const result = await api.remoteShell.upload(server, currentPath, mode)
      if (result.canceled) return
      const count = result.uploadedCount ?? result.uploaded.length
      if (count > 0 || result.uploaded.length > 0) {
        const detail = result.isDirectory
          ? (result.skippedSymlinks
            ? t('remoteFileBrowser.uploadedFilesToSkippedSymlinks', language, {
              count,
              target: result.uploaded[0] || currentPath,
              skipped: result.skippedSymlinks,
            })
            : t('remoteFileBrowser.uploadedFilesTo', language, { count, target: result.uploaded[0] || currentPath }))
          : (t('remoteFileBrowser.fileSUploadedTo', language, { count }))
        toast.success(
          t('remoteFileBrowser.uploadCompleted', language),
          detail,
        )
        await loadEntries(currentPath)
      }
    } catch (uploadError) {
      toast.error(t('remoteFileBrowser.uploadFailed', language), uploadError instanceof Error ? uploadError.message : String(uploadError))
    } finally {
      setUploading(false)
    }
  }, [currentPath, downloading, language, loadEntries, server, uploading])

  const handleDownload = useCallback(async (entry: RemoteFileEntry) => {
    if (downloading || uploading) return
    setDownloading(true)
    try {
      const result = await api.remoteShell.download(server, entry.path)
      if (result.canceled) return
      const detail = result.isDirectory
        ? (result.skippedSymlinks
          ? t('remoteFileBrowser.downloadedFilesToSkippedSymlinks', language, {
            count: result.downloadedCount ?? 0,
            target: result.localPath || '',
            skipped: result.skippedSymlinks,
          })
          : t('remoteFileBrowser.downloadedFilesTo', language, {
            count: result.downloadedCount ?? 0,
            target: result.localPath || '',
          }))
        : result.localPath || undefined
      toast.success(
        t('remoteFileBrowser.downloadCompleted', language),
        detail,
      )
    } catch (downloadError) {
      toast.error(t('remoteFileBrowser.downloadFailed', language), downloadError instanceof Error ? downloadError.message : String(downloadError))
    } finally {
      setDownloading(false)
    }
  }, [downloading, language, server, uploading])

  const pathSegments = useMemo(() => {
    const normalized = normalizePath(currentPath)
    if (normalized === '.') return [{ label: '.', path: '.' }]
    if (normalized === '/') return [{ label: '/', path: '/' }]
    const absolute = normalized.startsWith('/')
    const parts = normalized.split('/').filter(Boolean)
    const items: Array<{ label: string; path: string }> = []
    let acc = absolute ? '/' : ''
    if (absolute) items.push({ label: '/', path: '/' })
    parts.forEach((part) => {
      acc = acc === '/' ? `/${part}` : acc ? `${acc}/${part}` : part
      items.push({ label: part, path: acc })
    })
    return items
  }, [currentPath])

  if (!server.host.trim()) {
    return <div className="rounded-2xl border border-border bg-surface/40 p-4 text-sm text-text-muted">{t('remoteFileBrowser.setARemoteHost', language)}</div>
  }

  return (
    <div className="h-full rounded-2xl border border-border bg-surface/40 p-4 space-y-4 overflow-y-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-text-muted">SFTP</div>
          <div className="mt-1 text-sm text-text-primary break-all">{server.username ? `${server.username}@` : ''}{server.host}:{server.port || 22}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={handleTestConnection} disabled={testing} title={t('remoteFileBrowser.testConnection', language)}>
            <Wifi className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} title={t('remoteFileBrowser.closeSftpPanel', language)}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background/60 p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
          {pathSegments.map((segment, index) => (
            <button key={segment.path} onClick={() => loadEntries(segment.path)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-white/5 hover:text-text-primary">
              {index > 0 && <ChevronRight className="h-3 w-3" />}
              <span>{segment.label}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => loadEntries(currentPath)} leftIcon={<RefreshCw className="h-4 w-4" />}>{t('refresh', language)}</Button>
          <Button variant="ghost" size="sm" onClick={() => loadEntries(getParentPath(currentPath))}>{t('remoteFileBrowser.up', language)}</Button>
          <Button variant="ghost" size="sm" disabled={uploading || downloading} onClick={() => handleUpload('files')} leftIcon={<Upload className="h-4 w-4" />}>{uploading ? (t('remoteFileBrowser.uploading', language)) : (t('remoteFileBrowser.uploadFiles', language))}</Button>
          <Button variant="ghost" size="sm" disabled={uploading || downloading} onClick={() => handleUpload('directory')} leftIcon={<FolderUp className="h-4 w-4" />}>{t('remoteFileBrowser.uploadFolder', language)}</Button>
          <Button variant="ghost" size="sm" onClick={handleCreateFolder} leftIcon={<FolderPlus className="h-4 w-4" />}>{t('remoteFileBrowser.newFolder', language)}</Button>
          <Button variant="ghost" size="sm" onClick={handleCreateFile} leftIcon={<FileText className="h-4 w-4" />}>{t('remoteFileBrowser.newFile', language)}</Button>
        </div>
        {error && <div className="rounded-lg border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">{error}</div>}
        <div className="max-h-72 overflow-y-auto space-y-2">
          {loading ? <div className="px-2 py-3 text-sm text-text-muted">{t('remoteFileBrowser.loadingRemoteDirectory', language)}</div> : entries.length === 0 ? <div className="px-2 py-3 text-sm text-text-muted">{t('remoteFileBrowser.directoryIsEmpty', language)}</div> : entries.map((entry) => (
            <div key={entry.path} className={`rounded-xl border px-3 py-2 ${selectedFilePath === entry.path ? 'border-accent/50 bg-accent/10' : 'border-border bg-background/50'}`}>
              <div className="flex items-center gap-2">
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => entry.isDirectory ? loadEntries(entry.path) : openEmbeddedFile(entry.path)}
                  onDoubleClick={() => { if (!entry.isDirectory) void openInEditor(entry.path) }}
                >
                  {entry.isDirectory ? <Folder className="h-4 w-4 text-accent" /> : <FileText className="h-4 w-4 text-text-muted" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-text-primary">{entry.name}</div>
                    <div className="truncate text-xs text-text-muted">{entry.isDirectory ? (t('common.directory', language)) : formatSize(entry.size)}</div>
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={downloading || uploading}
                  onClick={() => handleDownload(entry)}
                  title={
                    downloading
                      ? (t('remoteFileBrowser.downloading', language))
                      : t(entry.isDirectory ? 'remoteFileBrowser.downloadFolder' : 'remoteFileBrowser.downloadFile', language)
                  }
                >
                      <Download className={`h-3.5 w-3.5 ${downloading ? 'animate-pulse' : ''}`} />
                    </Button>
                {!entry.isDirectory && (
                  <>
                    <Button variant="ghost" size="icon" onClick={() => void openInEditor(entry.path)} title={t('remoteFileBrowser.openInEditor', language)}>
                      <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                <Button variant="ghost" size="icon" onClick={() => handleRename(entry)} title={t('rename', language)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(entry)} title={t('delete', language)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedFilePath && (
        <div className="rounded-xl border border-border bg-background/60 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Input value={selectedFilePath} readOnly className="text-xs" />
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" disabled={downloading || uploading} onClick={() => handleDownload({ name: selectedFilePath.split('/').pop() || selectedFilePath, path: selectedFilePath, isDirectory: false, size: selectedFileContent.length })} leftIcon={<Download className="h-4 w-4" />}>{downloading ? (t('remoteFileBrowser.downloading2', language)) : (t('remoteFileBrowser.download', language))}</Button>
              <Button variant="ghost" size="sm" onClick={() => void openInEditor(selectedFilePath)} leftIcon={<SquareArrowOutUpRight className="h-4 w-4" />}>{t('remoteFileBrowser.openInEditor2', language)}</Button>
              <Button variant="primary" size="sm" onClick={saveFile} disabled={saving || !dirty} leftIcon={<Save className="h-4 w-4" />}>{saving ? (t('remoteFileBrowser.saving', language)) : (t('saveSession', language))}</Button>
            </div>
          </div>
          <textarea
            value={selectedFileContent}
            onChange={(event) => {
              setSelectedFileContent(event.target.value)
              setDirty(true)
            }}
            className="min-h-[220px] w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none"
            spellCheck={false}
          />
        </div>
      )}

      <Modal
        isOpen={Boolean(nameDialog)}
        onClose={() => setNameDialog(null)}
        title={
          !nameDialog
            ? ''
            : nameDialog.mode === 'create-folder'
              ? t('remoteFileBrowser.createFolder', language)
              : nameDialog.mode === 'create-file'
                ? t('remoteFileBrowser.createFile', language)
                : t('rename', language)
        }
        size="sm"
      >
        <div className="space-y-4">
          <Input
            value={nameDialog?.value || ''}
            onChange={(event) => setNameDialog((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
            placeholder={
              nameDialog?.mode === 'create-folder'
                ? t('remoteFileBrowser.enterFolderName', language)
                : nameDialog?.mode === 'create-file'
                  ? t('remoteFileBrowser.enterFileName', language)
                  : t('remoteFileBrowser.enterNewName', language)
            }
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleNameDialogConfirm()
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setNameDialog(null)}>
              {t('cancel', language)}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handleNameDialogConfirm()} disabled={!nameDialog?.value.trim()}>
              {t('remoteFileBrowser.confirm', language)}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
