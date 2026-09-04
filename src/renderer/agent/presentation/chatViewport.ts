/** Follow real content bounds; disclosures never create an artificial scroll range. */
export class ChatViewport {
  contentHeight = 0
  viewportHeight = 0
  scrollTop = 0
  following = true

  manualDisclosure(scrollTop: number) {
    this.following = false
    this.scrollTop = scrollTop
  }

  layout(contentHeight: number, viewportHeight: number) {
    const previousTop = this.scrollTop
    this.contentHeight = contentHeight
    this.viewportHeight = viewportHeight
    const bottom = Math.max(0, contentHeight - viewportHeight)
    // At the bottom, keep the final reply in place throughout the height change.
    // When reading history, keep the user's position until real bounds require a clamp.
    this.scrollTop = this.following ? bottom : Math.min(this.scrollTop, bottom)
    return { scrollTop: this.following || this.scrollTop !== previousTop ? this.scrollTop : undefined }
  }

  userScroll(top: number, threshold: number) {
    const movingUp = top < this.scrollTop - 1
    this.scrollTop = top
    this.following = !movingUp && this.contentHeight - top - this.viewportHeight <= threshold
  }

  jumpToBottom() {
    this.following = true
    this.scrollTop = Math.max(0, this.contentHeight - this.viewportHeight)
  }
}
