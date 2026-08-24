export type JsonRpcId = number | string | null

export interface JsonRpcErrorObject {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcMessage {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: unknown
  result?: unknown
  error?: JsonRpcErrorObject
}

export const JSON_RPC_METHOD_NOT_FOUND = -32601
export const LSP_CONTENT_MODIFIED = -32801

const CONTENT_MODIFIED_RETRY_METHODS = new Set([
  'textDocument/documentSymbol',
  'textDocument/definition',
  'textDocument/typeDefinition',
  'textDocument/implementation',
  'textDocument/references',
  'textDocument/hover',
  'textDocument/documentHighlight',
  'textDocument/prepareCallHierarchy',
  'callHierarchy/incomingCalls',
  'callHierarchy/outgoingCalls',
  'workspace/symbol',
])

export function encodeLspMessage(payload: unknown): string {
  const body = JSON.stringify(payload)
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
}

export function isServerRequest(message: JsonRpcMessage): boolean {
  return typeof message.method === 'string' && message.id !== undefined
}

export function isClientResponse(message: JsonRpcMessage): boolean {
  return message.method === undefined && message.id !== undefined
}

export function isServerNotification(message: JsonRpcMessage): boolean {
  return typeof message.method === 'string' && message.id === undefined
}

export function createJsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcMessage {
  return { jsonrpc: '2.0', id, result }
}

export function createJsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }
}

export function shouldRetryContentModified(method: string, error: unknown): boolean {
  return CONTENT_MODIFIED_RETRY_METHODS.has(method)
    && typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === LSP_CONTENT_MODIFIED
}

export function isCoalescibleReadMethod(method: string): boolean {
  return CONTENT_MODIFIED_RETRY_METHODS.has(method)
}
