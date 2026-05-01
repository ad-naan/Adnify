import { useState, useCallback, createContext, useContext, type ReactNode, useEffect } from 'react'
import { AlertTriangle, Info, Trash2 } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { logger } from '@utils/Logger'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'

interface ConfirmDialogProps {
  isOpen: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
  onConfirm: () => void
  onCancel: () => void
}

interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  variant = 'warning',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const language = useStore((state) => state.language)

  const variantStyles = {
    danger: {
      Icon: Trash2,
      iconGlow: 'bg-red-500/50',
      iconBg: 'bg-red-500/10 backdrop-blur-md',
      iconText: 'text-red-500',
      iconBorder: 'border-red-500/20',
      buttonVariant: 'danger' as const,
      buttonExtra: 'shadow-lg shadow-red-500/20',
    },
    warning: {
      Icon: AlertTriangle,
      iconGlow: 'bg-orange-500/50',
      iconBg: 'bg-orange-500/10 backdrop-blur-md',
      iconText: 'text-orange-500',
      iconBorder: 'border-orange-500/20',
      buttonVariant: 'primary' as const,
      buttonExtra: 'bg-orange-500 hover:bg-orange-600 shadow-lg shadow-orange-500/20 text-white border-transparent',
    },
    info: {
      Icon: Info,
      iconGlow: 'bg-blue-500/50',
      iconBg: 'bg-blue-500/10 backdrop-blur-md',
      iconText: 'text-blue-500',
      iconBorder: 'border-blue-500/20',
      buttonVariant: 'primary' as const,
      buttonExtra: 'shadow-lg shadow-blue-500/20',
    },
  }

  const styles = variantStyles[variant]
  const IconComponent = styles.Icon

  return (
    <Modal isOpen={isOpen} onClose={onCancel} size="sm" showCloseButton={false}>
      <div className="flex flex-col items-center text-center pt-4 pb-2 px-2">
        {/* Glowing Icon Wrapper */}
        <div className="relative mb-5">
          <div className={`absolute inset-0 blur-xl ${styles.iconGlow} rounded-full transform scale-110`} />
          <div className={`relative w-14 h-14 flex items-center justify-center rounded-2xl ${styles.iconBg} ${styles.iconText} border ${styles.iconBorder} shadow-inner`}>
            <IconComponent className="w-7 h-7" strokeWidth={2.5} />
          </div>
        </div>

        {/* Title & Message */}
        {title && (
          <h3 className="text-lg font-bold text-text-primary mb-2 tracking-tight">
            {title}
          </h3>
        )}
        <p className="text-[13px] text-text-secondary leading-relaxed mb-8 max-w-[280px]">
          {message}
        </p>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 w-full">
          <Button variant="ghost" className="flex-1 hover:bg-surface-hover font-medium" onClick={onCancel}>
            {cancelText || t('cancel', language)}
          </Button>
          <Button variant={styles.buttonVariant} className={`flex-1 font-medium ${styles.buttonExtra}`} onClick={onConfirm}>
            {confirmText || 'OK'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function useConfirmDialog() {
  const [state, setState] = useState<{
    isOpen: boolean
    options: ConfirmOptions | null
    resolve: ((value: boolean) => void) | null
  }>({
    isOpen: false,
    options: null,
    resolve: null,
  })

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        options,
        resolve,
      })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    state.resolve?.(true)
    setState({ isOpen: false, options: null, resolve: null })
  }, [state.resolve])

  const handleCancel = useCallback(() => {
    state.resolve?.(false)
    setState({ isOpen: false, options: null, resolve: null })
  }, [state.resolve])

  const DialogComponent = state.options ? (
    <ConfirmDialog
      isOpen={state.isOpen}
      {...state.options}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null

  return { confirm, DialogComponent }
}

const ConfirmContext = createContext<ConfirmContextType | null>(null)

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { confirm, DialogComponent } = useConfirmDialog()

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {DialogComponent}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const context = useContext(ConfirmContext)
  if (!context) {
    throw new Error('useConfirm must be used within ConfirmDialogProvider')
  }
  return context.confirm
}

let globalResolve: ((value: boolean) => void) | null = null
let globalSetState: ((state: { isOpen: boolean; options: ConfirmOptions | null }) => void) | null = null

export function GlobalConfirmDialog() {
  const [state, setState] = useState<{
    isOpen: boolean
    options: ConfirmOptions | null
  }>({
    isOpen: false,
    options: null,
  })

  useEffect(() => {
    globalSetState = setState
    return () => {
      globalSetState = null
    }
  }, [])

  const handleConfirm = useCallback(() => {
    globalResolve?.(true)
    globalResolve = null
    setState({ isOpen: false, options: null })
  }, [])

  const handleCancel = useCallback(() => {
    globalResolve?.(false)
    globalResolve = null
    setState({ isOpen: false, options: null })
  }, [])

  if (!state.options) return null

  return (
    <ConfirmDialog
      isOpen={state.isOpen}
      {...state.options}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  )
}

export function globalConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!globalSetState) {
      logger.ui.warn('GlobalConfirmDialog not mounted, canceling confirm request')
      resolve(false)
      return
    }

    globalResolve = resolve
    globalSetState({ isOpen: true, options })
  })
}
