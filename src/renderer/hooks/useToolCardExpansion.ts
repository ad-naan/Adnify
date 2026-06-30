import { useCallback, useEffect, useRef, useState } from 'react'

interface UseToolCardExpansionOptions {
  defaultExpanded?: boolean
  isActive: boolean
}

export function useToolCardExpansion({
  defaultExpanded = false,
  isActive,
}: UseToolCardExpansionOptions) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [animateContent, setAnimateContent] = useState(false)
  const wasActiveRef = useRef(isActive)
  const manuallyToggledRef = useRef(false)

  useEffect(() => {
    // 用户手动操作过，后续不再自动干预
    if (manuallyToggledRef.current) return

    // defaultExpanded=true：始终展开，不干预
    if (defaultExpanded) return

    // false→true：auto-expand，同时如果有旧的手动标志则重置
    if (isActive && !wasActiveRef.current) {
      manuallyToggledRef.current = false
      setAnimateContent(false)
      setIsExpanded(true)
    }
    // true→false：auto-collapse
    if (!isActive && wasActiveRef.current) {
      setAnimateContent(false)
      setIsExpanded(false)
    }

    wasActiveRef.current = isActive
  }, [defaultExpanded, isActive])

  const handleToggleExpanded = useCallback(() => {
    manuallyToggledRef.current = true
    setAnimateContent(true)
    setIsExpanded(prev => !prev)
  }, [])

  return {
    animateContent,
    handleToggleExpanded,
    isExpanded,
    setIsExpanded,
  }
}
