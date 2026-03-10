/**
 * 工具转换器 - 将应用工具定义转换为 AI SDK Tool 格式
 * 使用 AI SDK 6.0 的标准类型
 */

import { tool } from '@ai-sdk/provider-utils'
import { z } from 'zod'
import type { Tool } from '@ai-sdk/provider-utils'
import type { ToolDefinition } from '@shared/types'

export class ToolConverter {
  /**
   * 转换工具列表
   */
  convert(tools: ToolDefinition[]): Record<string, Tool> {
    const result: Record<string, Tool> = {}

    for (const t of tools) {
      const schema = this.convertSchema(t.parameters)
      result[t.name] = tool({
        description: t.description,
        inputSchema: schema as any,
        // 不提供 execute - 工具执行由外部处理
      })
    }

    return result
  }

  /**
   * 转换 JSON Schema 到 Zod Schema
   */
  private convertSchema(jsonSchema: Record<string, unknown>): z.ZodType {
    // 根级通常是一个 object schema
    return this.buildZodType({
      type: 'object',
      properties: jsonSchema.properties,
      required: jsonSchema.required
    })
  }

  private buildZodType(prop: Record<string, any>): z.ZodTypeAny {
    let zodType: z.ZodTypeAny

    switch (prop.type) {
      case 'string':
        if (Array.isArray(prop.enum) && prop.enum.length > 0) {
          zodType = z.enum(prop.enum as [string, ...string[]])
        } else {
          zodType = z.string()
        }
        break
      case 'number':
      case 'integer':
        zodType = z.number()
        break
      case 'boolean':
        zodType = z.boolean()
        break
      case 'array':
        if (prop.items) {
          zodType = z.array(this.buildZodType(prop.items))
        } else {
          zodType = z.array(z.any())
        }
        break
      case 'object':
        const properties = prop.properties || {}
        const requiredFields = Array.isArray(prop.required) ? prop.required : []
        const shape: Record<string, z.ZodTypeAny> = {}

        for (const [key, value] of Object.entries(properties)) {
          const isRequired = requiredFields.includes(key)
          let fieldSchema = this.buildZodType(value as Record<string, any>)
          if (!isRequired) {
            fieldSchema = fieldSchema.optional()
          }
          shape[key] = fieldSchema
        }
        zodType = z.object(shape)
        break
      default:
        zodType = z.any()
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description)
    }

    return zodType
  }
}
