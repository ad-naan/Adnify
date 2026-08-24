import { describe, expect, it } from 'vitest'
import {
  JSON_RPC_METHOD_NOT_FOUND,
  LSP_CONTENT_MODIFIED,
  createJsonRpcError,
  createJsonRpcResult,
  encodeLspMessage,
  isClientResponse,
  isCoalescibleReadMethod,
  isServerNotification,
  isServerRequest,
  shouldRetryContentModified,
} from '../../src/main/lsp/protocol'

describe('LSP JSON-RPC protocol helpers', () => {
  it('frames UTF-8 payloads using their byte length', () => {
    const payload = { jsonrpc: '2.0', id: 1, result: '中文' }
    const framed = encodeLspMessage(payload)
    const [header, body] = framed.split('\r\n\r\n')

    expect(header).toBe(`Content-Length: ${Buffer.byteLength(body, 'utf8')}`)
    expect(JSON.parse(body)).toEqual(payload)
  })

  it('distinguishes server requests from notifications', () => {
    expect(isServerRequest({ method: 'workspace/configuration', id: 0 })).toBe(true)
    expect(isServerRequest({ method: 'window/workDoneProgress/create', id: 'a' })).toBe(true)
    expect(isClientResponse({ id: 0, result: null })).toBe(true)
    expect(isClientResponse({ method: 'workspace/configuration', id: 0 })).toBe(false)
    expect(isServerNotification({ method: 'textDocument/publishDiagnostics' })).toBe(true)
    expect(isServerNotification({ method: 'workspace/configuration', id: 0 })).toBe(false)
  })

  it('creates valid success and error responses', () => {
    expect(createJsonRpcResult(7, null)).toEqual({ jsonrpc: '2.0', id: 7, result: null })
    expect(createJsonRpcError(8, JSON_RPC_METHOD_NOT_FOUND, 'Unsupported')).toEqual({
      jsonrpc: '2.0',
      id: 8,
      error: { code: JSON_RPC_METHOD_NOT_FOUND, message: 'Unsupported' },
    })
  })

  it('retries ContentModified only for safe read requests', () => {
    const error = Object.assign(new Error('content changed'), { code: LSP_CONTENT_MODIFIED })

    expect(shouldRetryContentModified('textDocument/definition', error)).toBe(true)
    expect(shouldRetryContentModified('textDocument/references', error)).toBe(true)
    expect(shouldRetryContentModified('textDocument/rename', error)).toBe(false)
    expect(shouldRetryContentModified('textDocument/definition', new Error('failed'))).toBe(false)
    expect(isCoalescibleReadMethod('textDocument/documentSymbol')).toBe(true)
    expect(isCoalescibleReadMethod('textDocument/rename')).toBe(false)
  })
})
