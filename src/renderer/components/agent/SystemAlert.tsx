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
    borderColor: 'border-red-500/15',
    iconBgColor: 'bg-red-500/10',
    iconColor: 'text-red-500',
    titleColor: 'text-red-400',
  },
  warning: {
    icon: AlertTriangle,
    bgColor: 'bg-amber-500/5',
    borderColor: 'border-amber-500/15',
    iconBgColor: 'bg-amber-500/10',
    iconColor: 'text-amber-500',
    titleColor: 'text-amber-400',
  },
  info: {
    icon: Info,
    bgColor: 'bg-blue-500/5',
    borderColor: 'border-blue-500/15',
    iconBgColor: 'bg-blue-500/10',
    iconColor: 'text-blue-500',
    titleColor: 'text-blue-400',
  },
  success: {
    icon: CheckCircle,
    bgColor: 'bg-green-500/5',
    borderColor: 'border-green-500/15',
    iconBgColor: 'bg-green-500/10',
    iconColor: 'text-green-500',
    titleColor: 'text-green-400',
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
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      transition={{ duration: 0.2 }}
      className={`group my-0.5 relative rounded-lg overflow-hidden transition-colors border ${config.bgColor} ${config.borderColor} ${className}`}
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {/* 图标 */}
        <div className="shrink-0 mt-[1.5px] w-4 h-4 flex items-center justify-center">
          <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${config.iconBgColor}`}>
            <Icon className={`w-2.5 h-2.5 ${config.iconColor}`} />
          </div>
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0 space-y-1">
          {/* 标题 */}
          {title && (
            <div className={`text-[12px] font-medium px-0.5 ${config.titleColor} tracking-tight`}>
              {title}
            </div>
          )}

          {/* 消息 */}
          <div className={`text-[11px] px-0.5 break-words ${title ? 'text-text-secondary' : config.titleColor} leading-relaxed`}>
            {message}
          </div>

          {/* 建议 */}
          {suggestion && (
            <div className="flex items-start gap-1.5 mt-2 pt-1.5 border-t border-border/30">
              <Lightbulb className="w-3 h-3 text-accent/70 shrink-0 mt-[1.5px]" />
              <span className="text-[11px] text-text-muted break-words leading-relaxed">
                {suggestion}
              </span>
            </div>
          )}
        </div>
      </div>
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
