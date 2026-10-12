import type { Transition } from 'framer-motion'

export const AGENT_DISCLOSURE_MANUAL_EVENT = 'agent-disclosure-manual'
/** How long collapsed content stays mounted, in ms. Must cover the .agent-disclosure exit transition. */
export const AGENT_DISCLOSURE_COLLAPSE_MS = 520
/** Reading dwell begins after the text/result is actually presented. */
export const AGENT_DISCLOSURE_CLOSE_DELAY_MS = 850
/** Must match tool-row-enter in globals.css. */
export const AGENT_ROW_ENTER_MS = 480
/** Standalone cards keep this fallback; timeline-controlled cards have no local timer. */
export const AGENT_DISCLOSURE_HANDOFF_CLOSE_MS = 0

/**
 * Motion for timeline rows and the panels inside them.
 *
 * Height is owned by the grid-rows disclosure (.agent-disclosure / .tool-row-enter),
 * so these curves only carry entrance and cross-fade, expressed in the same
 * language: short, decelerating, no overshoot. A spring with visible bounce reads
 * as a different product next to the tool rows.
 */
function decelerate(duration: number): Transition {
  return { duration, ease: [0.22, 1, 0.36, 1] }
}

/** Option rows and inline panels entering inside a card. */
export const AGENT_CONTENT_ENTER_TRANSITION = decelerate(0.24)
/** Content leaving an answered card — shorter, so the collapse leads the motion. */
export const AGENT_CONTENT_EXIT_TRANSITION = decelerate(0.16)
/** Rows that still own their entrance outside the timeline group. */
export const AGENT_ROW_ENTER_TRANSITION = decelerate(0.32)
