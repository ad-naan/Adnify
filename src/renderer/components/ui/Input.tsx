import React, { InputHTMLAttributes, forwardRef } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    leftIcon?: React.ReactNode
    rightIcon?: React.ReactNode
    error?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ className = '', leftIcon, rightIcon, error, ...props }, ref) => {
        return (
            <div className="relative flex items-center w-full group">
                {leftIcon && (
                    <div className="absolute left-3 z-10 text-text-muted pointer-events-none flex items-center justify-center transition-colors group-focus-within:text-accent">
                        {leftIcon}
                    </div>
                )}
                <input
                    ref={ref}
                    className={`
            flex h-10 w-full rounded-xl border px-3 py-1 text-sm text-text-primary placeholder:text-text-muted/40 
            shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]
            transition-all duration-200 ease-out
            bg-surface/50 backdrop-blur-sm border-border
            hover:bg-surface hover:border-border-active
            focus:outline-none focus:bg-surface/80 focus:border-accent/40 focus:ring-4 focus:ring-accent/10 focus:shadow-[0_0_0_1px_rgba(var(--accent)/0.2)]
            disabled:cursor-not-allowed disabled:opacity-50
            ${error ? 'border-status-error/50 focus:ring-status-error/20 focus:border-status-error' : ''}
            ${leftIcon ? 'pl-10' : ''}
            ${rightIcon ? 'pr-10' : ''}
            ${className}
          `}
                    {...props}
                />
                {rightIcon && (
                    <div className="absolute right-3 z-10 text-text-muted flex items-center justify-center transition-colors group-focus-within:text-accent">
                        {rightIcon}
                    </div>
                )}
            </div>
        )
    }
)

Input.displayName = "Input"
