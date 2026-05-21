/**
 * 内联创建输入框组件
 */

import { useState, useEffect, useRef } from 'react'
import { FolderPlus, FilePlus } from 'lucide-react'
import { Input } from '../../ui'

interface InlineCreateInputProps {
  type: 'file' | 'folder'
  depth: number
  onSubmit: (name: string) => void
  onCancel: () => void
}

export function InlineCreateInput({ type, depth, onSubmit, onCancel }: InlineCreateInputProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim())
    } else {
      onCancel()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 忽略 IME 组合状态中的按键
    if (e.nativeEvent.isComposing) return

    if (e.key === 'Enter') handleSubmit()
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div
      className="flex items-center gap-1.5 py-1 pr-2"
      style={{ paddingLeft: `${depth * 12 + 12}px` }}
    >
      <span className="w-3.5 flex-shrink-0" />
      {type === 'folder' ? (
        <FolderPlus className="w-3.5 h-3.5 text-accent flex-shrink-0" />
      ) : (
        <FilePlus className="w-3.5 h-3.5 text-accent flex-shrink-0" />
      )}
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={handleKeyDown}
        placeholder={type === 'file' ? 'filename.ext' : 'folder name'}
        className="flex-1 h-6 !rounded-md px-2 text-[13px] shadow-none focus:!ring-1 focus:shadow-none"
        autoFocus
      />
    </div>
  )
}
