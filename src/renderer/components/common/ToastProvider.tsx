/**
 * Toast 通知 - 重新导出内嵌式 Toast
 * 保持 API 兼容性
 */

export {
  InlineToastProvider as ToastProvider,
  useInlineToast as useToast,
  setGlobalInlineToast as setGlobalToast,
  toast,
} from './InlineToast'

export type { ToastType, ToastVariant, ToastAction, ToastMessage } from './InlineToast'
