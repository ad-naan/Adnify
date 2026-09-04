/** Geometry-only owner. It never reads execution or playback state. */
export class ChatViewport {
  contentHeight = 0
  viewportHeight = 0
  scrollTop = 0
  tail = 0
  following = true
  private holdUntil = 0
  private holding = false

  manualDisclosure(scrollTop: number, until: number) {
    this.following = false
    this.scrollTop = scrollTop
    this.holding = true
    this.holdUntil = until
  }

  beginCollapse(scrollTop: number, until: number) {
    if (!this.following || scrollTop <= 0) return
    this.scrollTop = scrollTop
    this.holding = true
    this.holdUntil = Math.max(this.holdUntil, until)
  }

  layout(contentHeight: number, viewportHeight: number, now: number) {
    if (this.following && this.scrollTop > 0
      && (contentHeight < this.contentHeight || viewportHeight > this.viewportHeight)) this.holding = true
    this.contentHeight = contentHeight
    this.viewportHeight = viewportHeight
    if (this.holding) {
      // The minimum tail that makes this anchor legal. No arbitrary viewport cap.
      this.tail = Math.max(0, this.scrollTop + viewportHeight - contentHeight)
      if (this.tail === 0 && now >= this.holdUntil) this.holding = false
    }
    if (this.following && !this.holding) this.scrollTop = Math.max(0, contentHeight - viewportHeight)
    return { tail: this.tail, scrollTop: this.following || this.holding ? this.scrollTop : undefined }
  }

  userScroll(top: number, threshold: number) {
    const movingUp = top < this.scrollTop - 1
    this.scrollTop = top
    const distance = Math.max(0, this.contentHeight + this.tail - top - this.viewportHeight)
    // Retire only space below the user's new viewport; removing it cannot clamp top.
    this.tail = Math.max(0, this.tail - distance)
    if (!this.tail) this.holding = false
    this.following = !movingUp && this.contentHeight + this.tail - top - this.viewportHeight <= threshold
  }

  jumpToBottom() {
    this.following = true
    this.holding = false
    this.holdUntil = 0
    this.tail = 0
    this.scrollTop = Math.max(0, this.contentHeight - this.viewportHeight)
  }
}
