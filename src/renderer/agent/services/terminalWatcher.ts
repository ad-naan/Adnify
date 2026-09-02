import { terminalManager } from '@/renderer/services/TerminalManager'
import { toast } from '@/renderer/components/common/ToastProvider'
import { useStore } from '@/renderer/store'
import { t } from '@shared/i18n'
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
                this.triggerDiagnosticAlert(id)
                this.lastAlertTimes.set(id, now)
            }
        }
    }

    private triggerDiagnosticAlert(id: string) {
        // 1. 把"终端命令失败"作为一条上下文证据交给情绪系统。
        //
        // 原来这里直接伪造一个 `emotion:changed` 推上总线（frustrated / 0.8 / 0.9），
        // 绕过检测引擎。三个后果：引擎的 `currentState` 不知道这回事，所以下一个窗口
        // 只要重算出同一个状态就不会再广播，UI 卡在 frustrated 上直到状态真的变；
        // 这一条不进 history，`getProductivityReport().frustrationEpisodes` 永远数不到
        // 终端失败；intensity 和 confidence 是拍出来的常数，和别处的量纲不一致。
        //
        // 现在只报事实，判定交给引擎 —— 它会在下一个窗口（≤12 秒）把这条证据算进去，
        // 走正常的平滑、history、广播。用户看到的即时反馈是下面那条 toast，不依赖情绪状态。
        EventBus.emit({ type: 'terminal:failed', terminalId: id })

        // 2. 抛出 UI Toast 给用户提示
        // 服务层没有 props，按渲染层惯例直接从 store 取当前语言。
        toast.error(t('terminalWatcher.commandFailed', useStore.getState().language), 5000)
    }
}

export const terminalWatcher = new TerminalWatcher()
