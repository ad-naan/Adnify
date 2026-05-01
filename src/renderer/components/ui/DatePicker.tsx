import React, { InputHTMLAttributes, useRef } from 'react'
import { Calendar } from 'lucide-react'

export interface DatePickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  className?: string
}

export function DatePicker({ value, onChange, placeholder = '选择日期', className = '', ...props }: DatePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleWrapperClick = () => {
    try {
      if (typeof inputRef.current?.showPicker === 'function') {
        inputRef.current.showPicker()
      } else {
        inputRef.current?.focus()
      }
    } catch (err) {
      // ignore
      inputRef.current?.focus()
    }
  }

  return (
    <div 
      className={`relative inline-flex items-center gap-2 px-3 py-1.5 border border-[rgb(var(--border)/0.6)] rounded-lg text-[rgb(var(--text-secondary))] hover:border-[rgb(var(--accent)/0.4)] hover:text-[rgb(var(--accent))] transition-colors cursor-pointer bg-[rgb(var(--surface)/0.5)] focus-within:border-[rgb(var(--accent)/0.8)] focus-within:ring-2 focus-within:ring-[rgb(var(--accent)/0.2)] overflow-hidden ${className}`}
      onClick={handleWrapperClick}
    >
      <span className="text-[13px] whitespace-nowrap select-none">{value || placeholder}</span>
      <Calendar className="w-3.5 h-3.5 opacity-70" />
      <input 
        ref={inputRef}
        type="date" 
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        value={value}
        onChange={onChange}
        {...props}
      />
    </div>
  )
}
