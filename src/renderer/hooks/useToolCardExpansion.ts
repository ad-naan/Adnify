import { useCallback, useEffect, useRef, useState } from 'react'

interface UseToolCardExpansionOptions {
  defaultExpanded?: boolean
  isActive: boolean
}

export function useToolCardExpansion({
  defaultExpanded = true,
  isActive,
}: UseToolCardExpansionOptions) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [animateContent, setAnimateContent] = useState(false)
  const wasActiveRef = useRef(isActive)

  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      setAnimateContent(false)
      setIsExpanded(true)
    }

    wasActiveRef.current = isActive
  }, [isActive])

  const handleToggleExpanded = useCallback(() => {
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
