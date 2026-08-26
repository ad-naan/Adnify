/** Renderer-local workers are duplicated by every BrowserWindow. */
export function calculateWorkerPoolSize(hardwareConcurrency?: number): number {
  const availableCores = Number.isFinite(hardwareConcurrency) && hardwareConcurrency! > 0
    ? Math.floor(hardwareConcurrency!)
    : 4
  return Math.min(2, Math.max(1, availableCores - 1))
}
