import { terminalManager } from '@/renderer/services/TerminalManager'
import { toast } from '@/renderer/components/common/ToastProvider'
import { EventBus } from '../core/EventBus'

class TerminalWatcher {
    private buffers: Map<string, string> = new Map()
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
    private lastAlertTimes: Map<string, number> = new Map()
    private unsubscribe: (() => void) | null = null

    // 每个终端最多 30 秒报警一次，避免刷屏
    private ALERT_COOLDOWN = 30000

    start() {
        if (this.unsubscribe) return

        this.unsubscribe = terminalManager.onData((id, data) => {
            this.handleData(id, data)
        })
    }

    stop() {
        if (this.unsubscribe) {
            this.unsubscribe()
            this.unsubscribe = null
        }

        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer)
        }
        this.debounceTimers.clear()
        this.buffers.clear()
        this.lastAlertTimes.clear()
    }

    private handleData(id: string, data: string) {
        if (!this.buffers.has(id)) {
            this.buffers.set(id, '')
        }

        // 累积缓冲区，最大保留 5000 字符
        let buffer = this.buffers.get(id)! + data
        if (buffer.length > 5000) buffer = buffer.slice(-5000)
        this.buffers.set(id, buffer)

        if (this.debounceTimers.has(id)) {
            clearTimeout(this.debounceTimers.get(id)!)
        }

        // debounce 1 秒，等待输出稍微稳定后再分析
        this.debounceTimers.set(id, setTimeout(() => {
            this.analyzeBuffer(id)
        }, 1000))
    }

    private analyzeBuffer(id: string) {
        const buffer = this.buffers.get(id) || ''
        // 移除 ANSI 转义符号以便正则匹配
        const cleanContent = buffer.replace(/\u001b\[[0-9;]*m/g, '')

        // 检测典型的错误关键字
        const errorPattern = /(npm ERR!|Error:|failed to compile|Failed to build|SyntaxError|UnhandledPromiseRejection|Traceback \(most recent call last\))/i

        if (errorPattern.test(cleanContent)) {
            const now = Date.now()
            const lastAlert = this.lastAlertTimes.get(id) || 0

            if (now - lastAlert > this.ALERT_COOLDOWN) {
                this.triggerDiagnosticAlert()
                this.lastAlertTimes.set(id, now)
            }
        }
    }

    private triggerDiagnosticAlert() {
        // 1. 触发 AI 情绪环境改变（如：变得警觉/关注，并推送消息）
        setTimeout(() => {
            EventBus.emit({
                type: 'emotion:changed',
                emotion: {
                    state: 'frustrated',
                    intensity: 0.8,
                    confidence: 0.9,
                    triggeredAt: Date.now(),
                    duration: 0,
                    factors: [{ type: 'error_rate', value: 1, weight: 1, description: '终端报错' }],
                    suggestions: ['发现终端报错 💥，您可以点击终端栏右上角的 ✨ 按钮让我一键分析！']
                }
            })
        }, 100)

        // 2. 抛出 UI Toast 给用户提示
        toast.error('检测到终端命令执行出错', 5000)
    }
}

export const terminalWatcher = new TerminalWatcher()
