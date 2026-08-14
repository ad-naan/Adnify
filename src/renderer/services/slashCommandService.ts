/**
 * 斜杠命令服务
 * 提供 /test, /explain, /refactor 等快捷命令
 */

export interface SlashCommand {
    name: string
    description: string
    aliases?: string[]
    handler: (args: string, context: SlashCommandContext) => SlashCommandResult
}

export interface SlashCommandContext {
    activeFilePath?: string
    selectedCode?: string
    workspacePath?: string
}

export interface SlashCommandResult {
    prompt: string
    mode?: 'agent'
}

// 内置斜杠命令
const commands: SlashCommand[] = [
    {
        name: 'test',
        aliases: ['tests'],
        description: 'Generate unit tests for the selected code or file',
        handler: (args, ctx) => ({
            prompt: buildPrompt('Generate comprehensive unit tests', args, ctx),
            mode: 'agent',
        }),
    },
    {
        name: 'explain',
        aliases: ['doc', 'docs'],
        description: 'Explain the selected code or file',
        handler: (args, ctx) => ({
            prompt: buildPrompt('Explain this code in detail', args, ctx),
            mode: 'agent',
        }),
    },
    {
        name: 'refactor',
        aliases: ['clean'],
        description: 'Refactor and improve the code quality',
        handler: (args, ctx) => ({
            prompt: buildPrompt('Refactor this code to improve readability and maintainability', args, ctx),
            mode: 'agent',
        }),
    },
    {
        name: 'fix',
        aliases: ['debug'],
        description: 'Fix bugs or issues in the code',
        handler: (args, ctx) => ({
            prompt: buildPrompt('Find and fix bugs in this code', args, ctx),
            mode: 'agent',
        }),
    },
    {
        name: 'optimize',
        aliases: ['perf'],
        description: 'Optimize code for performance',
        handler: (args, ctx) => ({
            prompt: buildPrompt('Optimize this code for better performance', args, ctx),
            mode: 'agent',
        }),
    },
    {
        name: 'comment',
        aliases: ['annotate'],
        description: 'Add comments and documentation',
        handler: (args, ctx) => ({
            prompt: buildPrompt('Add clear comments and documentation to this code', args, ctx),
            mode: 'agent',
        }),
    },
    {
        name: 'type',
        aliases: ['types', 'typescript'],
        description: 'Add TypeScript types',
        handler: (args, ctx) => ({
            prompt: buildPrompt('Add proper TypeScript types to this code', args, ctx),
            mode: 'agent',
        }),
    },
]

function buildPrompt(action: string, args: string, ctx: SlashCommandContext): string {
    let prompt = action

    if (args.trim()) {
        prompt += `: ${args}`
    }

    if (ctx.selectedCode) {
        prompt += `\n\nSelected code:\n\`\`\`\n${ctx.selectedCode}\n\`\`\``
    } else if (ctx.activeFilePath) {
        prompt += ` for file: ${ctx.activeFilePath}`
    }

    return prompt
}

class SlashCommandService {
    private commands: SlashCommand[] = commands

    /**
     * 获取所有可用命令
     */
    getCommands(): SlashCommand[] {
        return this.commands
    }

    /**
     * 根据输入查找匹配的命令
     */
    findMatching(inputText: string): SlashCommand[] {
        if (!inputText.startsWith('/')) return []

        const query = inputText.slice(1).toLowerCase().split(' ')[0]
        if (!query) return this.commands

        return this.commands.filter(cmd => {
            if (cmd.name.toLowerCase().startsWith(query)) return true
            if (cmd.aliases?.some(a => a.toLowerCase().startsWith(query))) return true
            return false
        })
    }

    /**
     * 解析并执行命令
     */
    parse(inputText: string, context: SlashCommandContext): SlashCommandResult | null {
        if (!inputText.startsWith('/')) return null

        const parts = inputText.slice(1).split(' ')
        const cmdName = parts[0].toLowerCase()
        const args = parts.slice(1).join(' ')

        const cmd = this.commands.find(c => {
            if (c.name.toLowerCase() === cmdName) return true
            if (c.aliases?.some(a => a.toLowerCase() === cmdName)) return true
            return false
        })

        if (!cmd) return null

        return cmd.handler(args, context)
    }

    /**
     * 检查输入是否是斜杠命令
     */
    isCommand(text: string): boolean {
        return text.startsWith('/') && this.parse(text, {}) !== null
    }
}

export const slashCommandService = new SlashCommandService()
