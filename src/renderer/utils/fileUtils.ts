/**
 * 文件操作工具函数
 * 统一处理文件打开、大文件检测等
 */

import { api } from '@/renderer/services/electronAPI'
import { useStore } from '@store'
import { LargeFileInfo } from '@store/slices/fileSlice'
import {
  getFileInfo,
  getLargeFileWarning,
  isLargeFile
} from '@services/largeFileService'
import { toast } from '@components/common/ToastProvider'
import { globalConfirm } from '../components/common/ConfirmDialog'
import { getFileName } from '@shared/utils/pathUtils'

// ============ 配置常量 ============

const FILE_CONFIG = {
  /** 超大文件阈值（超过此大小需要确认） */
  confirmThreshold: 5 * 1024 * 1024, // 5MB
  /** 最大文件大小（超过此大小拒绝打开） */
  maxFileSize: 50 * 1024 * 1024, // 50MB
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
    const msg = language === 'zh'
      ? '无法打开二进制文件'
      : 'Cannot open binary file'
    if (showWarning) {
      toast.warning(msg, getFileName(filePath))
    }
    return { success: false, error: msg, isBinary: true }
  }

  try {
    // 2. 读取文件内容
    const content = await api.file.read(filePath)

    if (content === null) {
      const msg = language === 'zh' ? '文件不存在' : 'File not found'
      if (showWarning) {
        toast.error(msg, filePath)
      }
      return { success: false, error: msg }
    }

    // 3. 检查文件大小
    if (content.length > FILE_CONFIG.maxFileSize) {
      const msg = language === 'zh'
        ? '文件太大，无法打开'
        : 'File is too large to open'
      if (showWarning) {
        toast.error(msg, `${(content.length / 1024 / 1024).toFixed(1)} MB`)
      }
      return { success: false, error: msg, isLargeFile: true }
    }

    // 4. 大文件确认
    if (confirmLargeFile && content.length > FILE_CONFIG.confirmThreshold) {
      const { t } = await import('../i18n')
      const size = (content.length / 1024 / 1024).toFixed(1)

      const confirmed = await globalConfirm({
        title: language === 'zh' ? '大文件警告' : 'Large File Warning',
        message: t('confirmLargeFile', language, { size }),
        confirmText: language === 'zh' ? '继续' : 'Continue',
        variant: 'warning',
      })

      if (!confirmed) {
        return { success: false, error: 'Cancelled by user', isLargeFile: true }
      }
    }

    // 5. 检测大文件信息
    const largeFileInfo = detectLargeFile(content, filePath, language)

    // 6. 显示大文件警告
    if (showWarning && largeFileInfo?.warning) {
      toast.warning(
        language === 'zh' ? '大文件' : 'Large File',
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
        language === 'zh' ? '打开文件失败' : 'Failed to open file',
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
    const msg = language === 'zh'
      ? `最多同时打开 ${maxFiles} 个文件`
      : `Can only open ${maxFiles} files at once`
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
      language === 'zh' ? '部分文件打开失败' : 'Some files failed to open',
      `${opened}/${filePaths.length}`
    )
  }

  return { opened, failed }
}
