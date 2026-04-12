/**
 * 对话分支辅助组件 (Branch Controls)
 * 包含 BranchSelector (头部入口) 和 MessageBranchActions (消息气泡操作)
 */

import { useState, useCallback } from 'react'
import { GitBranch, RotateCcw, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAgentStore, selectBranches, selectActiveBranch, selectIsOnBranch } from '@/renderer/agent/store/AgentStore'
import { Button } from '../ui'

/**
 * 分支选择器 - 显示在聊天面板顶部左侧
 * 始终显示当前分支状态，点击展开分支管理
 */
export function BranchSelector({ 
  language = 'en',
  onClick 
}: { 
  language?: 'zh' | 'en'
  onClick?: () => void 
}) {
  const activeBranch = useAgentStore(selectActiveBranch)
  const branches = useAgentStore(selectBranches)
  const isOnBranch = useAgentStore(selectIsOnBranch)

  // 计算显示文本
  const displayText = isOnBranch && activeBranch 
    ? activeBranch.name 
    : (language === 'zh' ? '主线' : 'Main')

  const hasBranches = branches.length > 0

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all duration-200 group ${
        isOnBranch 
          ? 'bg-accent/10 border border-accent/20 text-accent hover:bg-accent/15' 
          : 'bg-surface/30 border border-transparent hover:border-border/40 hover:bg-surface/50 text-text-muted hover:text-text-primary'
      }`}
      title={language === 'zh' ? '点击管理分支' : 'Click to manage branches'}
    >
      <GitBranch className={`w-3.5 h-3.5 ${isOnBranch ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`} />
      <span className="truncate max-w-[120px] font-medium">{displayText}</span>
      {hasBranches && !isOnBranch && (
        <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-surface text-[9px] font-bold border border-border/50">
          {branches.length}
        </span>
      )}
      <ChevronDown className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity" />
    </button>
  )
}

/**
 * 消息操作按钮 - 创建分支/重新生成
 */
export function MessageBranchActions({
  messageId,
  language = 'en',
  onRegenerate,
}: {
  messageId: string
  language?: 'zh' | 'en'
  onRegenerate?: (messageId: string) => void
}) {
  const [showConfirm, setShowConfirm] = useState(false)

  const handleCreateBranch = useCallback(() => {
    if (onRegenerate) {
      onRegenerate(messageId)
    }
    setShowConfirm(false)
  }, [messageId, onRegenerate])

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowConfirm(!showConfirm)}
        className={`text-xs gap-1.5 h-7 px-2.5 transition-all ${showConfirm ? 'bg-accent/10 text-accent' : 'hover:bg-surface/50'}`}
        title={language === 'zh' ? '重新生成（创建分支）' : 'Regenerate (create branch)'}
      >
        <RotateCcw className={`w-3.5 h-3.5 ${showConfirm ? 'text-accent' : ''}`} />
        <span>{language === 'zh' ? '重新生成' : 'Regenerate'}</span>
      </Button>

      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 5 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute top-full right-0 mt-2 p-3 rounded-xl bg-background/80 backdrop-blur-xl border border-border/50 shadow-xl shadow-black/20 z-50 min-w-[260px]"
          >
            <div className="absolute -top-1.5 right-6 w-3 h-3 bg-background/80 backdrop-blur-xl border-t border-l border-border/50 transform rotate-45" />
            
            <p className="text-xs text-text-secondary mb-3 leading-relaxed relative z-10">
              {language === 'zh' 
                ? '这将创建一个新分支并重新生成回复，原有对话将被保留在当前分支中。' 
                : 'This will create a new branch and regenerate the response. The original conversation will be preserved.'}
            </p>
            <div className="flex gap-2 relative z-10">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConfirm(false)}
                className="flex-1 h-7 text-xs hover:bg-black/10"
              >
                {language === 'zh' ? '取消' : 'Cancel'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleCreateBranch}
                className="flex-1 h-7 text-xs whitespace-nowrap bg-accent hover:bg-accent-hover text-white shadow-lg shadow-accent/20"
              >
                <GitBranch className="w-3.5 h-3.5 mr-1.5" />
                {language === 'zh' ? '创建分支' : 'Create Branch'}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
