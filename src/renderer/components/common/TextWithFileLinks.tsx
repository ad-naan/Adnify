import React, { useCallback, useMemo } from 'react'
import { useStore } from '@store'
import { joinPath } from '@shared/utils/pathUtils'
import { safeOpenFile } from '@renderer/utils/fileUtils'

interface TextWithFileLinksProps {
    text: string
    className?: string
}

export function TextWithFileLinks({ text, className = '' }: TextWithFileLinksProps) {
    const workspacePath = useStore(s => s.workspacePath)

    const handleFileClick = useCallback(async (e: React.MouseEvent, filePath: string) => {
        e.stopPropagation()
        let absPath = filePath
        const isAbsolute = /^([a-zA-Z]:[\\/]|[/])/.test(filePath)
        if (!isAbsolute && workspacePath) {
            absPath = joinPath(workspacePath, absPath)
        }

        try {
            await safeOpenFile(absPath, { showWarning: false, confirmLargeFile: false })
        } catch (error) {
            // Ignore if not a valid file
        }
    }, [workspacePath])

    const elements = useMemo(() => {
        if (!text) return null

        // Match string patterns that look like file paths: 
        // 1) Absolute Windows or Unix paths
        // 2) Relative paths with extensions (e.g. index.ts, cs.html)
        // 3) Relative paths with slashes (e.g. src/index.ts)
        const regex = /((?:(?:[a-zA-Z]:[\\/]|[/])[\w.-]+(?:[\\/][\w.-]+)*)|(?:[a-zA-Z0-9_-]+(?:[\\/][a-zA-Z0-9_-]+)*\.[a-zA-Z0-9]+))/g

        const parts = text.split(regex)

        return parts.map((part, i) => {
            if (part && regex.test(part)) {
                // To avoid false positives on very short matched extensions
                if (part.length > 2) {
                    return (
                        <span
                            key={`part-${i}-${part.slice(0, 20)}`}
                            className="cursor-pointer hover:underline hover:text-accent transition-colors break-all"
                            onClick={(e) => handleFileClick(e, part)}
                            title="Click to open file"
                        >
                            {part}
                        </span>
                    )
                }
            }
            return <span key={`part-${i}-${part?.slice(0, 20)}`} className="break-all">{part}</span>
        })
    }, [text, handleFileClick])

    return (
        <span className={className}>
            {elements}
        </span>
    )
}
