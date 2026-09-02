/**
 * 统一的错误处理工具
 * 提供类型安全的错误处理和用户友好的错误消息
 */

import {
  APICallError,
  NoContentGeneratedError,
  InvalidPromptError,
  InvalidResponseDataError,
  EmptyResponseBodyError,
  LoadAPIKeyError,
  NoSuchModelError,
  TypeValidationError,
  UnsupportedFunctionalityError,
} from '@ai-sdk/provider'

import {
  NoOutputGeneratedError,
  RetryError,
} from 'ai'

import { isProviderAuthErrorMessage } from '@shared/errors/providerAuthError'
import { t, type Language, type TranslationKey } from '@shared/i18n'

export enum ErrorCode {
  // 通用错误
  UNKNOWN = 'UNKNOWN',
  NETWORK = 'NETWORK',
  TIMEOUT = 'TIMEOUT',
  ABORTED = 'ABORTED',

  // 文件系统错误
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_ACCESS_DENIED = 'FILE_ACCESS_DENIED',
  FILE_READ = 'FILE_READ',
  FILE_WRITE = 'FILE_WRITE',

  // API 错误
  API_KEY_INVALID = 'API_KEY_INVALID',
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  API_CALL_FAILED = 'API_CALL_FAILED',

  // LSP 错误
  LSP_NOT_INITIALIZED = 'LSP_NOT_INITIALIZED',
  LSP_REQUEST_FAILED = 'LSP_REQUEST_FAILED',

  // MCP 错误
  MCP_NOT_INITIALIZED = 'MCP_NOT_INITIALIZED',
  MCP_SERVER_ERROR = 'MCP_SERVER_ERROR',
  MCP_TOOL_ERROR = 'MCP_TOOL_ERROR',

  // LLM 错误
  LLM_NO_CONTENT = 'LLM_NO_CONTENT',
  LLM_NO_OUTPUT = 'LLM_NO_OUTPUT',
  LLM_INVALID_PROMPT = 'LLM_INVALID_PROMPT',
  LLM_INVALID_RESPONSE = 'LLM_INVALID_RESPONSE',
  LLM_EMPTY_RESPONSE = 'LLM_EMPTY_RESPONSE',
  LLM_NO_SUCH_MODEL = 'LLM_NO_SUCH_MODEL',
  LLM_VALIDATION_FAILED = 'LLM_VALIDATION_FAILED',
  LLM_UNSUPPORTED = 'LLM_UNSUPPORTED',
}

/**
 * 标准错误类
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly retryable: boolean = false,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
    Error.captureStackTrace?.(this, AppError)
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      retryable: this.retryable,
      details: this.details,
    }
  }
}

/**
 * `ErrorCode` → 文案键。
 *
 * 用穷尽 Record 而不是 `` t(`errorCode.${code}`) ``：`ErrorCode` 的值是 SCREAMING_SNAKE，
 * 拼不出 camelCase 的键名。样板是 `src/main/services/privilegeCapabilities.ts` 的
 * `PRIVILEGE_CAPABILITY_REASON_KEYS` —— 少一个枚举成员编译期就报错，和模板字面量类型同样严。
 *
 * 有三条指向早就存在的 `error.*`（那一段的文案和这里逐字重合），其余补在 `errorCode.*`。
 * `error.timeout` / `error.apiKeyInvalid` / `error.rateLimited` 看着像可以并进来，但它们的
 * 文案多带一句建议（"Please try again."），和这里的短句不是一回事，没并 —— 那一段除了
 * `error.unknown` 和 `error.fileNotFound` 之外今天没有任何调用点，并进来等于顺手改文案。
 * `error.fileNotFound` 也没并：它带 `{path}` 占位符，而 `getErrorMessage` 没有传参的通道。
 */
const ERROR_MESSAGE_KEYS: Record<ErrorCode, TranslationKey> = {
  [ErrorCode.UNKNOWN]: 'error.unknown',
  [ErrorCode.NETWORK]: 'error.networkError',
  [ErrorCode.TIMEOUT]: 'errorCode.timeout',
  [ErrorCode.ABORTED]: 'errorCode.aborted',
  [ErrorCode.FILE_NOT_FOUND]: 'errorCode.fileNotFound',
  [ErrorCode.FILE_ACCESS_DENIED]: 'error.permissionDenied',
  [ErrorCode.FILE_READ]: 'errorCode.fileRead',
  [ErrorCode.FILE_WRITE]: 'errorCode.fileWrite',
  [ErrorCode.API_KEY_INVALID]: 'errorCode.apiKeyInvalid',
  [ErrorCode.API_RATE_LIMIT]: 'errorCode.apiRateLimit',
  [ErrorCode.API_CALL_FAILED]: 'errorCode.apiCallFailed',
  [ErrorCode.LSP_NOT_INITIALIZED]: 'errorCode.lspNotInitialized',
  [ErrorCode.LSP_REQUEST_FAILED]: 'errorCode.lspRequestFailed',
  [ErrorCode.MCP_NOT_INITIALIZED]: 'errorCode.mcpNotInitialized',
  [ErrorCode.MCP_SERVER_ERROR]: 'errorCode.mcpServerError',
  [ErrorCode.MCP_TOOL_ERROR]: 'errorCode.mcpToolError',
  [ErrorCode.LLM_NO_CONTENT]: 'errorCode.llmNoContent',
  [ErrorCode.LLM_NO_OUTPUT]: 'errorCode.llmNoOutput',
  [ErrorCode.LLM_INVALID_PROMPT]: 'errorCode.llmInvalidPrompt',
  [ErrorCode.LLM_INVALID_RESPONSE]: 'errorCode.llmInvalidResponse',
  [ErrorCode.LLM_EMPTY_RESPONSE]: 'errorCode.llmEmptyResponse',
  [ErrorCode.LLM_NO_SUCH_MODEL]: 'errorCode.llmNoSuchModel',
  [ErrorCode.LLM_VALIDATION_FAILED]: 'errorCode.llmValidationFailed',
  [ErrorCode.LLM_UNSUPPORTED]: 'errorCode.llmUnsupported',
}

/**
 * 获取错误消息
 *
 * `language` 默认 `'en'`：主进程那 16 个 `toAppError` 调用点一个都没传，所以主进程今天拿到的
 * 一直是英文。这次只把文案搬进 locale 表，没动这个语义。
 */
export function getErrorMessage(code: ErrorCode, language: Language = 'en'): string {
  return t(ERROR_MESSAGE_KEYS[code] ?? ERROR_MESSAGE_KEYS[ErrorCode.UNKNOWN], language)
}

/**
 * 映射 Node.js 系统错误
 * 返回错误码和原始消息，不返回友好消息
 */
export function mapNodeError(error: NodeJS.ErrnoException): { code: ErrorCode; originalMessage: string; retryable: boolean } {
  const code = error.code || ''
  const originalMessage = error.message

  switch (code) {
    case 'ENOENT':
      return { code: ErrorCode.FILE_NOT_FOUND, originalMessage, retryable: false }

    case 'EACCES':
    case 'EPERM':
      return { code: ErrorCode.FILE_ACCESS_DENIED, originalMessage, retryable: false }

    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return { code: ErrorCode.TIMEOUT, originalMessage, retryable: true }

    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'ENETUNREACH':
      return { code: ErrorCode.NETWORK, originalMessage, retryable: true }

    default:
      return { code: ErrorCode.UNKNOWN, originalMessage: originalMessage || 'System error', retryable: false }
  }
}

/**
 * 映射 AI SDK 错误（使用类型安全的 isInstance 方法）
 * 返回 ErrorCode 和原始错误消息（用于日志），不返回友好消息
 */
export function mapAISDKError(error: unknown): { code: ErrorCode; originalMessage: string; retryable: boolean } {
  // 确保是 Error 对象
  if (!(error instanceof Error)) {
    return {
      code: ErrorCode.UNKNOWN,
      originalMessage: String(error),
      retryable: false,
    }
  }

  const originalMessage = error.message

  // NoOutputGeneratedError - 通常包装了其他错误，优先提取 cause
  if (NoOutputGeneratedError.isInstance(error)) {
    const cause = (error as NoOutputGeneratedError & { cause?: unknown }).cause
    if (cause) {
      return mapAISDKError(cause)
    }
    return {
      code: ErrorCode.LLM_NO_OUTPUT,
      originalMessage,
      retryable: true,
    }
  }

  // RetryError - 提取 lastError
  if (RetryError.isInstance(error)) {
    const lastError = (error as RetryError).lastError
    if (lastError) {
      return mapAISDKError(lastError)
    }
    return {
      code: ErrorCode.UNKNOWN,
      originalMessage,
      retryable: false,
    }
  }

  // NoContentGeneratedError
  if (NoContentGeneratedError.isInstance(error)) {
    return {
      code: ErrorCode.LLM_NO_CONTENT,
      originalMessage,
      retryable: true,
    }
  }

  // APICallError - 根据状态码细分
  if (APICallError.isInstance(error)) {
    const statusCode = error.statusCode
    const responseBody = error.responseBody

    // 尝试从 responseBody 提取详细信息
    let detailMessage = originalMessage
    if (responseBody && typeof responseBody === 'string') {
      try {
        const body = JSON.parse(responseBody)
        if (body.detail) {
          detailMessage = `${originalMessage}: ${body.detail}`
        } else if (body.message) {
          detailMessage = `${originalMessage}: ${body.message}`
        }
      } catch {
        // JSON 解析失败，使用原始消息
      }
    }

    if (statusCode === 429) {
      return {
        code: ErrorCode.API_RATE_LIMIT,
        originalMessage: detailMessage,
        retryable: true,
      }
    }
    if (statusCode === 401 || statusCode === 403) {
      return {
        code: ErrorCode.API_KEY_INVALID,
        originalMessage: detailMessage,
        retryable: false,
      }
    }
    return {
      code: ErrorCode.API_CALL_FAILED,
      originalMessage: detailMessage,
      retryable: error.isRetryable ?? true,
    }
  }

  // InvalidPromptError
  if (InvalidPromptError.isInstance(error)) {
    return {
      code: ErrorCode.LLM_INVALID_PROMPT,
      originalMessage,
      retryable: false,
    }
  }

  // InvalidResponseDataError
  if (InvalidResponseDataError.isInstance(error)) {
    return {
      code: ErrorCode.LLM_INVALID_RESPONSE,
      originalMessage,
      retryable: true,
    }
  }

  // EmptyResponseBodyError
  if (EmptyResponseBodyError.isInstance(error)) {
    return {
      code: ErrorCode.LLM_EMPTY_RESPONSE,
      originalMessage,
      retryable: true,
    }
  }

  // LoadAPIKeyError
  if (LoadAPIKeyError.isInstance(error)) {
    return {
      code: ErrorCode.API_KEY_INVALID,
      originalMessage,
      retryable: false,
    }
  }

  // NoSuchModelError
  if (NoSuchModelError.isInstance(error)) {
    return {
      code: ErrorCode.LLM_NO_SUCH_MODEL,
      originalMessage,
      retryable: false,
    }
  }

  // TypeValidationError
  if (TypeValidationError.isInstance(error)) {
    return {
      code: ErrorCode.LLM_VALIDATION_FAILED,
      originalMessage,
      retryable: false,
    }
  }

  // UnsupportedFunctionalityError
  if (UnsupportedFunctionalityError.isInstance(error)) {
    return {
      code: ErrorCode.LLM_UNSUPPORTED,
      originalMessage,
      retryable: false,
    }
  }

  // AbortError (标准 DOM 错误)
  if (error.name === 'AbortError') {
    return {
      code: ErrorCode.ABORTED,
      originalMessage,
      retryable: false,
    }
  }

  // 兜底：按 error.name 识别（兼容非 SDK 实例，如测试或 RPC 序列化后的错误）
  if (error.name === 'NoContentGeneratedError') {
    return {
      code: ErrorCode.LLM_NO_CONTENT,
      originalMessage,
      retryable: true,
    }
  }
  const statusCode = (error as Error & { statusCode?: number }).statusCode
  if (error.name === 'APICallError' && typeof statusCode === 'number') {
    if (statusCode === 429) {
      return { code: ErrorCode.API_RATE_LIMIT, originalMessage, retryable: true }
    }
    if (statusCode === 401 || statusCode === 403) {
      return { code: ErrorCode.API_KEY_INVALID, originalMessage, retryable: false }
    }
    return {
      code: ErrorCode.API_CALL_FAILED,
      originalMessage,
      retryable: (error as Error & { isRetryable?: boolean }).isRetryable ?? true,
    }
  }

  // 检查错误消息中的关键词（兜底）
  //
  // 关键词猜测只对无结构的 message 成立。供应商鉴权那几条错误的原因码是编进 message 的
  // （主进程没有界面语言，见 `providerAuthError.ts`），而 `oauthLoginTimeout` 这个码名里
  // 就带 `timeout` —— 一旦在这里猜中，下面 `toAppError` 会用 `getErrorMessage(TIMEOUT)`
  // 把整条 message 换成"请求超时"，码在到达渲染层之前就没了。有结构的先退出。
  if (isProviderAuthErrorMessage(originalMessage)) {
    return { code: ErrorCode.UNKNOWN, originalMessage, retryable: false }
  }

  const msg = originalMessage.toLowerCase()
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) {
    return {
      code: ErrorCode.NETWORK,
      originalMessage,
      retryable: true,
    }
  }
  if (
    msg === 'terminated' ||
    msg.includes('terminated') ||
    msg.includes('socket hang up') ||
    msg.includes('other side closed') ||
    msg.includes('connection closed')
  ) {
    return {
      code: ErrorCode.NETWORK,
      originalMessage,
      retryable: true,
    }
  }
  if (msg.includes('timeout')) {
    return {
      code: ErrorCode.TIMEOUT,
      originalMessage,
      retryable: true,
    }
  }

  // 未知错误
  return {
    code: ErrorCode.UNKNOWN,
    originalMessage,
    retryable: false,
  }
}

/**
 * 将任意错误转换为 AppError
 * 使用英文友好消息（前端可根据用户语言转换）
 */
export function toAppError(error: unknown, language: Language = 'en'): AppError {
  if (error instanceof AppError) {
    return error
  }

  if (error instanceof Error) {
    // 尝试进行启发式分析 (包含对 fetch, network, timeout 等关键词的识别)
    const mapped = mapAISDKError(error)
    if (mapped.code !== ErrorCode.UNKNOWN) {
      const friendlyMessage = getErrorMessage(mapped.code, language)
      return new AppError(friendlyMessage, mapped.code, mapped.retryable, error)
    }

    // Node.js 系统错误 (如果有 code 且启发式分析未捕获)
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code) {
      const nodeMapped = mapNodeError(nodeError)
      const friendlyMessage = getErrorMessage(nodeMapped.code, language)
      return new AppError(friendlyMessage, nodeMapped.code, nodeMapped.retryable, error)
    }

    // 普通 Error：保留原始消息便于排查
    return new AppError(error.message, ErrorCode.UNKNOWN, false, error)
  }

  if (typeof error === 'string') {
    return new AppError(error, ErrorCode.UNKNOWN, false)
  }

  const friendlyMessage = getErrorMessage(ErrorCode.UNKNOWN, language)
  return new AppError(friendlyMessage, ErrorCode.UNKNOWN, false, error)
}
