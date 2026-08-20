/**
 * Return the latest streamed content without adding a second render loop.
 *
 * StreamingBuffer already controls the reveal cadence. Mirroring every content
 * prop into local state made each chunk render once with stale text and again
 * after the effect ran; both passes walked the Markdown tree. Direct content
 * also guarantees the final flush is visible immediately.
 */
export function useSmoothStream(content: string, _isStreaming: boolean, _speedMultiplier = 1) {
  return content
}
