export interface DiagnosticsCaptureOptions {
  kind: 'memory' | 'trace'
  includeHeapProfiling?: boolean
}

export type DiagnosticsCaptureResult =
  | { success: true; directory: string }
  | { success: false; code: 'CANCELED' | 'BUSY' | 'FAILED' }
