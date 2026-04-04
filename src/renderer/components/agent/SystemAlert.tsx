/**
 * 系统级别错误/警告提示组件
 * 设计风格：玻璃质感 + 渐变边框 + 图标动画
 */

import React from 'react'
import { AlertTriangle, Info, XCircle, CheckCircle, Lightbulb } from 'lucide-react'
import { motion } from 'framer-motion'

export type AlertType = 'error' | 'warning' | 'info' | 'success'

interface SystemAlertProps {
  type: AlertType
  title?: string
  message: string
  suggestion?: string
  className?: string
}

const alertConfig = {
  error: {
    icon: XCircle,
    bgColor: 'bg-red-500/5',
    borderColor: 'border-red-500/20',
    iconColor: 'text-red-400',
    titleColor: 'text-red-300',
    glowColor: 'shadow-red-500/10',
  },
  warning: {
    icon: AlertTriangle,
    bgColor: 'bg-amber-500/5',
    borderColor: 'border-amber-500/20',
    iconColor: 'text-amber-400',
    titleColor: 'text-amber-300',
    glowColor: 'shadow-amber-500/10',
  },
  info: {
    icon: Info,
    bgColor: 'bg-blue-500/5',
    borderColor: 'border-blue-500/20',
    iconColor: 'text-blue-400',
    titleColor: 'text-blue-300',
    glowColor: 'shadow-blue-500/10',
  },
  success: {
    icon: CheckCircle,
    bgColor: 'bg-green-500/5',
    borderColor: 'border-green-500/20',
    iconColor: 'text-green-400',
    titleColor: 'text-green-300',
    glowColor: 'shadow-green-500/10',
  },
}

export const SystemAlert: React.FC<SystemAlertProps> = ({
  type,
  title,
  message,
  suggestion,
  className = '',
}) => {
  const config = alertConfig[type]
  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={`
        relative overflow-hidden rounded-xl border backdrop-blur-xl
        ${config.bgColor} ${config.borderColor} ${config.glowColor}
        shadow-lg my-4
        ${className}
      `}
    >
      {/* 渐变背景装饰 */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />

      {/* 顶部光晕 */}
      <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-${type === 'error' ? 'red' : type === 'warning' ? 'amber' : type === 'success' ? 'green' : 'blue'}-400/30 to-transparent`} />

      <div className="relative px-4 py-3.5 flex gap-3">
        {/* 图标 */}
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 200, damping: 15 }}
          className="flex-shrink-0 mt-0.5"
        >
          <div className={`
            w-8 h-8 rounded-lg flex items-center justify-center
            ${config.bgColor} ${config.borderColor} border
            ${config.glowColor} shadow-md
          `}>
            <Icon className={`w-4.5 h-4.5 ${config.iconColor}`} />
          </div>
        </motion.div>

        {/* 内容 */}
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* 标题 */}
          {title && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 }}
              className={`text-sm font-semibold ${config.titleColor} tracking-tight`}
            >
              {title}
            </motion.div>
          )}

          {/* 消息 */}
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="text-[13px] text-text-secondary leading-relaxed"
          >
            {message}
          </motion.div>

          {/* 建议 */}
          {suggestion && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 }}
              className="flex items-start gap-2 mt-2 pt-2 border-t border-border/30"
            >
              <Lightbulb className="w-3.5 h-3.5 text-accent/70 flex-shrink-0 mt-0.5" />
              <span className="text-[12px] text-text-muted leading-relaxed">
                {suggestion}
              </span>
            </motion.div>
          )}
        </div>
      </div>

      {/* 底部光晕 */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
    </motion.div>
  )
}

/**
 * 从文本中解析系统警告
 * 格式：⚠️ reason\n💡 suggestion
 */
export function parseSystemAlert(text: string): {
  type: AlertType
  title?: string
  message: string
  suggestion?: string
} | null {
  // 检测循环警告
  const loopPattern = /⚠️\s*(.+?)(?:\n💡\s*(.+))?$/s
  const match = text.match(loopPattern)

  if (match) {
    const message = match[1].trim()
    const suggestion = match[2]?.trim()

    // 根据消息内容判断类型
    let type: AlertType = 'warning'
    let title = 'Loop Detected'

    if (message.includes('repeating pattern')) {
      title = 'Detected Repeating Pattern'
    } else if (message.includes('exact repeat')) {
      title = 'Exact Repeat Detected'
    } else if (message.includes('cycling')) {
      title = 'Content Cycling Detected'
    }

    return { type, title, message, suggestion }
  }

  return null
}
