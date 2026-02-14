import { useState, useEffect, useRef, useMemo } from 'react'

interface UseFluidTypewriterOptions {
    /** Base speed (chars per frame) - typical frame is ~16ms */
    baseSpeed?: number
    /** Speed multiplier based on remaining distance */
    accelerationFactor?: number
    /** Whether to enable fluid effect */
    enabled?: boolean
}

/**
 * A refined fluid typewriter hook.
 * Uses floating point arithmetic for sub-character smoothness and time-delta normalization.
 */
export const useFluidTypewriter = (
    content: string,
    isStreaming: boolean,
    options: UseFluidTypewriterOptions = {}
) => {
    const {
        baseSpeed = 0.5, // slightly slower base speed for smoother feel
        accelerationFactor = 0.1, // Adjusted for the new algorithm
        enabled = true
    } = options

    // If disabled, short-circuit
    if (!enabled) {
        return {
            displayedContent: content,
            isTyping: false
        }
    }

    // State
    const [displayedLength, setDisplayedLength] = useState(() => {
        // If not streaming, or content is empty, show full/empty immediately
        if (!isStreaming) return content.length
        // If content is very short (just starting), show immediately to avoid lag
        if (content.length < 5) return content.length
        return 0
    })


    const lastFrameTime = useRef<number>(0)
    const animationFrameId = useRef<number>()
    const isStreamingRef = useRef(isStreaming)

    // Update ref for use in animation loop
    useEffect(() => {
        isStreamingRef.current = isStreaming
    }, [isStreaming])

    // If streaming stops, ensure we snap to end eventually, or immediately?
    // User wants "silky", so let's let it finish typing even if stream stops, 
    // unless the jump is huge.
    useEffect(() => {
        if (!isStreaming) {
            // If we were typing and stream stopped, we might want to fast-forward
            // but for now, let's just snap to ensure consistency like original logic
            // providing a "settled" state.
            setDisplayedLength(content.length)
        }
    }, [isStreaming, content.length])

    // Animation Loop
    useEffect(() => {
        // Only animate if we are behind
        if (displayedLength >= content.length) {
            return
        }

        const animate = (time: number) => {
            if (!lastFrameTime.current) lastFrameTime.current = time
            const delta = time - lastFrameTime.current
            lastFrameTime.current = time

            // Calculate dynamic speed
            // If we are far behind, speed up significantly
            const remaining = content.length - displayedLength

            // Speed = Base + (Remaining * Factor)
            // Using time-based delta (assuming ~60fps, delta ~16.6ms)
            // Normalize speed to "chars per 16ms frame"
            const currentSpeed = baseSpeed + (remaining * accelerationFactor)

            // Increment length based on time delta to be framerate independent
            // (delta / 16.6) is the ratio of a "standard frame"
            const increment = currentSpeed * (delta / 16.6)

            setDisplayedLength(prev => {
                const next = prev + increment
                if (next >= content.length) {
                    return content.length
                }
                return next
            })

            if (displayedLength < content.length) {
                animationFrameId.current = requestAnimationFrame(animate)
            }
        }

        animationFrameId.current = requestAnimationFrame(animate)
        return () => {
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current)
            lastFrameTime.current = 0
        }
    }, [content.length, displayedLength, baseSpeed, accelerationFactor])

    // Derive string from length
    const displayedContent = useMemo(() => {
        if (displayedLength >= content.length) return content
        return content.slice(0, Math.floor(displayedLength))
    }, [content, displayedLength])

    return {
        displayedContent,
        isTyping: isStreamingRef.current && displayedLength < content.length
    }
}
