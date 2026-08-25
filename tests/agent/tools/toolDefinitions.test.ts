/**
 * 工具定义测试
 * 测试工具注册和验证
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  toolRegistry,
  initializeToolProviders,
} from '@renderer/agent/tools'
import { generateToolDefinition, TOOL_SCHEMAS, TOOL_CONFIGS } from '@/shared/config/tools'
import { getToolsForContext } from '@/shared/config/toolGroups'

// Mock dependencies that tools need
vi.mock('@renderer/services/WorkspaceManager', () => ({
  workspaceManager: {
    getCurrentWorkspacePath: vi.fn(() => '/test/workspace'),
  },
}))

vi.mock('@renderer/agent/core/Agent', () => ({
  Agent: {
    hasValidFileCache: vi.fn(() => false),
  },
}))

describe('Tool Definitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initializeToolProviders()
  })

  describe('Tool Schemas', () => {
    it('should have TOOL_SCHEMAS object', () => {
      expect(TOOL_SCHEMAS).toBeDefined()
      expect(typeof TOOL_SCHEMAS).toBe('object')
    })

    it('should have TOOL_CONFIGS object', () => {
      expect(TOOL_CONFIGS).toBeDefined()
      expect(typeof TOOL_CONFIGS).toBe('object')
    })

    it('should have read_file in configs', () => {
      expect(TOOL_CONFIGS.read_file).toBeDefined()
      expect(TOOL_CONFIGS.read_file.name).toBe('read_file')
    })

    it('should have read_image in configs', () => {
      expect(TOOL_CONFIGS.read_image).toBeDefined()
      expect(TOOL_CONFIGS.read_image.name).toBe('read_image')
    })

    it('should have edit_file in configs', () => {
      expect(TOOL_CONFIGS.edit_file).toBeDefined()
      expect(TOOL_CONFIGS.edit_file.name).toBe('edit_file')
    })

    it('should have create_directory in configs', () => {
      expect(TOOL_CONFIGS.create_directory).toBeDefined()
      expect(TOOL_CONFIGS.create_directory.name).toBe('create_directory')
    })

    it('should not expose removed file tools', () => {
      expect(TOOL_CONFIGS.create_file_or_folder).toBeUndefined()
      expect(TOOL_CONFIGS.replace_file_content).toBeUndefined()
      expect(TOOL_SCHEMAS.create_file_or_folder).toBeUndefined()
      expect(TOOL_SCHEMAS.replace_file_content).toBeUndefined()
    })

    it('should have run_command in configs', () => {
      expect(TOOL_CONFIGS.run_command).toBeDefined()
      expect(TOOL_CONFIGS.run_command.name).toBe('run_command')
    })

    it('marks nested approval scope fields as required for tool providers', () => {
      const definition = generateToolDefinition(TOOL_CONFIGS.run_command)
      const approvalScope = definition.parameters.properties.approval_scope

      expect(approvalScope.required).toEqual(['executable', 'argument_prefix', 'description'])
    })

    it('should expose semantic symbol tools with valid schemas', () => {
      expect(TOOL_CONFIGS.find_symbol).toBeDefined()
      expect(getToolsForContext({ mode: 'agent' })).toContain('find_symbol')
      expect(getToolsForContext({ mode: 'plan' })).toContain('find_symbol')
      expect(TOOL_SCHEMAS.find_symbol.safeParse({ name_path: 'Editor/render' }).success).toBe(true)
      expect(TOOL_SCHEMAS.get_document_symbols.safeParse({ relative_path: 'src/editor.ts', depth: 1 }).success).toBe(true)
      expect(TOOL_SCHEMAS.get_document_symbols.parse({ relative_path: 'src/editor.ts' }).depth).toBe(0)
      // The whole LSP family addresses files as relative_path; `path` was an outlier.
      expect(TOOL_SCHEMAS.get_document_symbols.safeParse({ path: 'src/editor.ts' }).success).toBe(false)
      expect(TOOL_SCHEMAS.find_references.safeParse({ relative_path: 'src/editor.ts', name_path: 'Editor/render' }).success).toBe(true)
      expect(TOOL_SCHEMAS.find_references.safeParse({ path: 'src/editor.ts', line: 1, column: 1 }).success).toBe(false)
      expect(TOOL_SCHEMAS.navigate_symbol.safeParse({ relative_path: 'src/editor.ts', name_path: 'Editor/render', relation: 'definition' }).success).toBe(true)
      expect(TOOL_SCHEMAS.navigate_symbol.safeParse({ relative_path: 'src/editor.ts', name_path: 'Editor/render', relation: 'references' }).success).toBe(false)
      expect(TOOL_SCHEMAS.get_hover_info.safeParse({ relative_path: 'src/editor.ts', name_path: 'Editor/render' }).success).toBe(true)
      expect(TOOL_SCHEMAS.navigate_symbol.safeParse({ relative_path: 'src/types.ts', name_path: 'Editor', relation: 'implementation' }).success).toBe(true)
      expect(getToolsForContext({ mode: 'agent' })).toContain('navigate_symbol')
      expect(TOOL_SCHEMAS.edit_symbol.safeParse({ relative_path: 'src/a.ts', name_path: 'A/run', action: 'replace', body: 'run() {}' }).success).toBe(true)
      expect(TOOL_SCHEMAS.edit_symbol.safeParse({ relative_path: 'src/a.ts', name_path: 'A/run', action: 'remove', body: '' }).success).toBe(false)
      expect(TOOL_SCHEMAS.rename_symbol.safeParse({ relative_path: 'src/a.ts', name_path: 'A/run', new_name: 'execute' }).success).toBe(true)
      expect(getToolsForContext({ mode: 'agent' })).toContain('edit_symbol')
      expect(getToolsForContext({ mode: 'plan' })).not.toContain('edit_symbol')
      expect(TOOL_SCHEMAS.get_diagnostics.safeParse({ relative_path: 'src/a.ts', name_path: 'A/run', min_severity: 2 }).success).toBe(true)
      expect(getToolsForContext({ mode: 'plan' })).toContain('get_diagnostics')
    })

    it('should generate schemas from configs', () => {
      // TOOL_SCHEMAS should have same keys as TOOL_CONFIGS
      const configKeys = Object.keys(TOOL_CONFIGS)
      const schemaKeys = Object.keys(TOOL_SCHEMAS)
      
      expect(schemaKeys.length).toBeGreaterThan(0)
      // At least some configs should have schemas
      expect(schemaKeys.length).toBeGreaterThanOrEqual(configKeys.length * 0.5)
    })

    it('should allow read_file paths arrays', () => {
      const readFileSchema = TOOL_SCHEMAS.read_file
      expect(readFileSchema).toBeDefined()

      const result = readFileSchema.safeParse({
        paths: ['src/a.ts', 'src/b.ts'],
      })

      expect(result.success).toBe(true)
      expect(readFileSchema.safeParse({ path: 'src/a.ts', paths: ['src/b.ts'] }).success).toBe(false)
    })

    it('should accept inverted line ranges in read_file', () => {
      const readFileSchema = TOOL_SCHEMAS.read_file
      expect(readFileSchema).toBeDefined()

      // Runtime resolveReadFileRequest auto-swaps; schema must not reject the call.
      const result = readFileSchema.safeParse({
        path: 'src/main.ts',
        start_line: 20,
        end_line: 10,
      })

      expect(result.success).toBe(true)
    })

    it('should validate read_image path and optional prompt', () => {
      const readImageSchema = TOOL_SCHEMAS.read_image
      expect(readImageSchema).toBeDefined()

      expect(readImageSchema.safeParse({ path: 'images/ui.png' }).success).toBe(true)
      expect(readImageSchema.safeParse({ path: 'images/ui.png', prompt: 'Extract chart labels' }).success).toBe(true)
      expect(readImageSchema.safeParse({}).success).toBe(false)
    })

    it('should validate create_directory path', () => {
      const createDirectorySchema = TOOL_SCHEMAS.create_directory
      expect(createDirectorySchema).toBeDefined()

      expect(createDirectorySchema.safeParse({ path: 'src/utils' }).success).toBe(true)
      expect(createDirectorySchema.safeParse({ path: 'src/utils/' }).success).toBe(true)
      expect(createDirectorySchema.safeParse({}).success).toBe(false)
    })

    it('should ignore placeholder line fields and empty edits in edit_file string mode', () => {
      const editFileSchema = TOOL_SCHEMAS.edit_file
      expect(editFileSchema).toBeDefined()

      const result = editFileSchema.safeParse({
        path: 'portal/src/pages/dashboard/DocsPage.tsx',
        old_string: "const DocsPage = () => {\n  const [selectedKey, setSelectedKey] = useState('quick-start');\n\n  const menuItems = [",
        new_string: "const DocsPage = () => {\n  const [selectedKey, setSelectedKey] = useState('quick-start');\n  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';\n  const openAIBaseUrl = apiBaseUrl.endsWith('/v1') ? apiBaseUrl : `${apiBaseUrl}/v1`;\n  const chatCompletionsUrl = `${window.location.origin}${openAIBaseUrl}/chat/completions`;\n  const openAIBaseUrlAbsolute = `${window.location.origin}${openAIBaseUrl}`;\n\n  const menuItems = [",
        start_line: 1,
        end_line: 1,
        content: '',
        replace_all: false,
        edits: [],
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.start_line).toBeUndefined()
        expect(result.data.end_line).toBeUndefined()
        expect(result.data.content).toBeUndefined()
        expect(result.data.edits).toBeUndefined()
      }
    })

    it('should ignore empty edits in edit_file line mode', () => {
      const editFileSchema = TOOL_SCHEMAS.edit_file
      expect(editFileSchema).toBeDefined()

      const result = editFileSchema.safeParse({
        path: 'src/example.ts',
        old_string: '',
        new_string: '',
        start_line: 3,
        end_line: 4,
        content: 'const updated = true',
        edits: [],
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.old_string).toBeUndefined()
        expect(result.data.new_string).toBeUndefined()
        expect(result.data.edits).toBeUndefined()
      }
    })

    it('should still reject genuine mixed edit_file modes', () => {
      const editFileSchema = TOOL_SCHEMAS.edit_file
      expect(editFileSchema).toBeDefined()

      const result = editFileSchema.safeParse({
        path: 'src/example.ts',
        old_string: 'before',
        new_string: 'after',
        start_line: 3,
        end_line: 4,
        content: 'const updated = true',
      })

      expect(result.success).toBe(false)
    })

    it('should accept line mode when batch fields are only empty mirrored placeholders', () => {
      const editFileSchema = TOOL_SCHEMAS.edit_file
      expect(editFileSchema).toBeDefined()

      const result = editFileSchema.safeParse({
        path: 'app/page.tsx',
        content: 'export default function HomePage() {\n  return null\n}',
        edits: [
          {
            action: 'replace',
            start_line: 1,
            end_line: 356,
            content: '',
          },
        ],
        start_line: 1,
        end_line: 356,
        old_string: '',
        new_string: '',
        replace_all: false,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.edits).toBeUndefined()
        expect(result.data.old_string).toBeUndefined()
        expect(result.data.new_string).toBeUndefined()
      }
    })
  })

  describe('toolRegistry', () => {
    it('should have registry methods', () => {
      expect(typeof toolRegistry.register).toBe('function')
      expect(typeof toolRegistry.get).toBe('function')
      expect(typeof toolRegistry.has).toBe('function')
      expect(typeof toolRegistry.validate).toBe('function')
    })

    it('should validate using schemas', () => {
      // Test that schemas can be used for validation
      const readFileSchema = TOOL_SCHEMAS.read_file
      if (readFileSchema) {
        const validResult = readFileSchema.safeParse({ path: 'src/main.ts' })
        expect(validResult.success).toBe(true)
        
        const invalidResult = readFileSchema.safeParse({})
        expect(invalidResult.success).toBe(false)
      }
    })
  })
})
