import type ParserType = require('web-tree-sitter')

type ParserConstructor = typeof ParserType

interface ModuleShape {
  default?: unknown
  Parser?: unknown
  Language?: unknown
  init?: unknown
  load?: unknown
}

export interface TreeSitterRuntime {
  Parser: ParserConstructor
  Language: typeof ParserType.Language
  init: (options?: { locateFile?: (scriptName: string, scriptDirectory: string) => string }) => Promise<void>
}

let runtime: TreeSitterRuntime | null = null
let initialization: Promise<TreeSitterRuntime> | null = null

function asModule(value: unknown): ModuleShape {
  return value && (typeof value === 'object' || typeof value === 'function')
    ? value as ModuleShape
    : {}
}

async function createRuntime(
  options: { locateFile?: (scriptName: string, scriptDirectory: string) => string }
): Promise<TreeSitterRuntime> {
  // Electron/Vite can expose this CommonJS package as the constructor itself,
  // an ESM namespace, or a nested synthetic default export. Resolve the API by
  // capability instead of relying on one interop shape.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const imported: unknown = require('web-tree-sitter')
  const root = asModule(imported)
  const firstDefault = asModule(root.default)
  const secondDefault = asModule(firstDefault.default)
  const candidates: unknown[] = [
    imported,
    root.Parser,
    root.default,
    firstDefault.Parser,
    firstDefault.default,
    secondDefault.Parser,
  ]

  const Parser = candidates.find(candidate => typeof candidate === 'function') as ParserConstructor | undefined
  const parserShape = asModule(Parser)
  const init = [parserShape.init, root.init, firstDefault.init, secondDefault.init]
    .find(candidate => typeof candidate === 'function') as TreeSitterRuntime['init'] | undefined

  if (!Parser || !init) {
    const exportKeys = Object.keys(root)
    throw new TypeError(
      `Unsupported web-tree-sitter module shape (exports: ${exportKeys.length ? exportKeys.join(', ') : 'constructor/empty namespace'})`
    )
  }

  await init.call(
    parserShape.init === init ? Parser
      : root.init === init ? imported
        : firstDefault.init === init ? root.default
          : firstDefault.default,
    options
  )

  // web-tree-sitter@0.20 attaches Language to Parser during init(), so this
  // lookup must happen after the WASM runtime has initialized.
  const initializedParserShape = asModule(Parser)
  const initializedRoot = asModule(imported)
  const initializedDefault = asModule(initializedRoot.default)
  const Language = [
    initializedParserShape.Language,
    initializedRoot.Language,
    initializedDefault.Language,
    asModule(initializedDefault.default).Language,
  ].find(candidate => candidate && typeof asModule(candidate).load === 'function') as typeof ParserType.Language | undefined

  if (!Language) {
    throw new TypeError('web-tree-sitter initialized without exposing Language.load')
  }

  return {
    Parser,
    Language,
    init: async () => undefined,
  }
}

export function initializeTreeSitter(
  options: { locateFile?: (scriptName: string, scriptDirectory: string) => string }
): Promise<TreeSitterRuntime> {
  if (!initialization) {
    initialization = (async () => {
      runtime = await createRuntime(options)
      return runtime
    })().catch(error => {
      // Allow a later retry when the failure was caused by a temporarily
      // unavailable WASM resource during application startup.
      initialization = null
      throw error
    })
  }
  return runtime ? Promise.resolve(runtime) : initialization
}
