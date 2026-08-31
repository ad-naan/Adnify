/**
 * 文件操作工具函数
 * 统一处理文件打开、大文件检测等
 */

import { api } from '@/renderer/services/electronAPI'
import { useStore } from '@store'
import {
  LARGE_FILE_CONFIRM_BYTES,
  LARGE_FILE_PAGE_BYTES,
  MAX_EDITABLE_TEXT_FILE_BYTES,
  type LargeFileInfo,
} from '@shared/types/largeFile'
import {
  getFileInfo,
  getLargeFileWarning,
  isLargeFile
} from '@services/largeFileService'
import { toast } from '@components/common/ToastProvider'
import { globalConfirm } from '../components/common/ConfirmDialog'
import { t, asLanguage } from '../i18n'
import { getFileName } from '@shared/utils/pathUtils'
import { detectEolFromContent } from '@services/fileFormatService'

// ============ 配置常量 ============

const FILE_CONFIG = {
  /** 超大文件阈值（超过此大小需要确认） */
  confirmThreshold: LARGE_FILE_CONFIRM_BYTES,
  /** 最大文件大小（超过此大小拒绝打开） */
  maxFileSize: MAX_EDITABLE_TEXT_FILE_BYTES,
  /** 二进制文件扩展名 */
  binaryExtensions: new Set([
    'exe', 'dll', 'so', 'dylib', 'bin', 'obj', 'o', 'a', 'lib',
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg',
    'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv', 'flv',
    'zip', 'tar', 'gz', 'rar', '7z', 'bz2',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'ttf', 'otf', 'woff', 'woff2', 'eot',
    'db', 'sqlite', 'sqlite3',
  ]),
} as const

// ============ 类型定义 ============

export interface OpenFileOptions {
  /** 是否显示大文件警告 */
  showWarning?: boolean
  /** 是否需要确认打开大文件 */
  confirmLargeFile?: boolean
  /** 语言（用于警告消息） */
  language?: 'en' | 'zh'
  /** 原始内容（用于 diff） */
  originalContent?: string
}

export interface OpenFileResult {
  success: boolean
  error?: string
  isLargeFile?: boolean
  isBinary?: boolean
}

// ============ 工具函数 ============

/**
 * 检查文件是否为二进制文件
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return FILE_CONFIG.binaryExtensions.has(ext)
}

/**
 * 检测文件大小信息
 */
export function detectLargeFile(content: string, filePath: string, language: 'en' | 'zh' = 'en'): LargeFileInfo | undefined {
  if (!isLargeFile(content)) {
    return undefined
  }

  const info = getFileInfo(filePath, content)
  const warning = getLargeFileWarning(info, language)

  return {
    path: filePath,
    isLarge: info.isLarge,
    isVeryLarge: info.isVeryLarge,
    size: info.size,
    lineCount: info.lineCount,
    warning: warning || undefined,
  }
}

/**
 * 安全打开文件
 * 处理大文件检测、二进制文件检测、错误处理等
 */
export async function safeOpenFile(
  filePath: string,
  options: OpenFileOptions = {}
): Promise<OpenFileResult> {
  const {
    showWarning = true,
    confirmLargeFile = true,
    language = 'en',
    originalContent,
  } = options

  const { openFile, setActiveFile } = useStore.getState()

  // 1. 检查二进制文件
  if (isBinaryFile(filePath)) {
    const msg = t('fileUtils.cannotOpenBinaryFile', asLanguage(language))
    if (showWarning) {
      toast.warning(msg, getFileName(filePath))
    }
    return { success: false, error: msg, isBinary: true }
  }

  try {
    // 2. 先用 stat 判断体积，再决定是否读取。
    // 读取回来的内容长度不能用来判断大小：主进程对超大文件只返回前导切片，
    // 于是 content.length 永远落在阈值以下，两道防线形同虚设，
    // 而这份被截断的内容一旦保存就会覆盖磁盘上的完整文件。
    const stats = await api.file.stat(filePath)
    const byteSize = stats?.size ?? 0

    // 3. 检查文件大小
    if (byteSize > FILE_CONFIG.maxFileSize) {
      const chunk = await api.file.readTextChunk(filePath, 0, LARGE_FILE_PAGE_BYTES)
      if (!chunk) {
        const msg = t('fileUtils.couldNotReadVery', asLanguage(language))
        if (showWarning) toast.error(msg, filePath)
        return { success: false, error: msg, isLargeFile: true }
      }

      openFile(filePath, chunk.content, originalContent, {
        kind: 'large-preview',
        encoding: 'utf-8',
        eol: detectEolFromContent(chunk.content),
        largeFileInfo: {
          path: filePath,
          size: byteSize,
          lineCount: -1,
          isLarge: true,
          isVeryLarge: true,
          reason: 'size',
        },
        largeFileView: {
          startOffset: chunk.startOffset,
          nextOffset: chunk.nextOffset,
          totalSize: chunk.totalSize,
          eof: chunk.eof,
          chunkSize: LARGE_FILE_PAGE_BYTES,
        },
      })
      setActiveFile(filePath)
      if (showWarning) {
        toast.warning(
          t('fileUtils.openedInVeryLarge', asLanguage(language)),
          `${(byteSize / 1024 / 1024).toFixed(1)} MB`,
        )
      }
      return { success: true, isLargeFile: true }
    }

    // 4. 大文件确认
    if (confirmLargeFile && byteSize > FILE_CONFIG.confirmThreshold) {
      const size = (byteSize / 1024 / 1024).toFixed(1)

      const confirmed = await globalConfirm({
        title: t('fileUtils.largeFileWarning', asLanguage(language)),
        message: t('confirmLargeFile', language, { size }),
        confirmText: t('git.continue', asLanguage(language)),
        variant: 'warning',
      })

      if (!confirmed) {
        return { success: false, error: 'Cancelled by user', isLargeFile: true }
      }
    }

    // 5. 读取完整内容。编辑器缓冲区是可写的，必须拿到全文，
    // 否则一次保存就会把文件截断到预览切片的长度。
    const content = await api.file.readFull(filePath)

    if (content === null) {
      const msg = t('fileUtils.fileNotFound', asLanguage(language))
      if (showWarning) {
        toast.error(msg, filePath)
      }
      return { success: false, error: msg }
    }

    // 5. 检测大文件信息
    const largeFileInfo = detectLargeFile(content, filePath, language)

    // 6. 显示大文件警告
    if (showWarning && largeFileInfo?.warning) {
      toast.warning(
        t('fileUtils.largeFile', asLanguage(language)),
        largeFileInfo.warning
      )
    }

    // 7. 打开文件
    // 编码检测已在主进程实现 (secureFile.ts:readFileWithEncoding):
    // - UTF-8 BOM 自动去除
    // - 二进制文件检测
    openFile(filePath, content, originalContent, {
      largeFileInfo,
      encoding: 'utf-8',
      eol: detectEolFromContent(content),
    })
    setActiveFile(filePath)

    return {
      success: true,
      isLargeFile: largeFileInfo?.isLarge
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    if (showWarning) {
      toast.error(
        t('git.openFileFailed', asLanguage(language)),
        msg
      )
    }
    return { success: false, error: msg }
  }
}

/**
 * 批量打开文件（限制数量）
 */
export async function safeOpenFiles(
  filePaths: string[],
  options: OpenFileOptions = {}
): Promise<{ opened: number; failed: number }> {
  const maxFiles = 10 // 最多同时打开 10 个文件
  const language = options.language || 'en'

  if (filePaths.length > maxFiles) {
    const msg = t('fileUtils.canOnlyOpenFiles', asLanguage(language), { maxFiles })
    toast.warning(msg)
    filePaths = filePaths.slice(0, maxFiles)
  }

  let opened = 0
  let failed = 0

  for (const filePath of filePaths) {
    const result = await safeOpenFile(filePath, {
      ...options,
      showWarning: false, // 批量打开时不显示单个警告
      confirmLargeFile: false, // 批量打开时不确认
    })

    if (result.success) {
      opened++
    } else {
      failed++
    }
  }

  if (failed > 0) {
    toast.warning(
      t('fileUtils.someFilesFailedTo', asLanguage(language)),
      `${opened}/${filePaths.length}`
    )
  }

  return { opened, failed }
}
