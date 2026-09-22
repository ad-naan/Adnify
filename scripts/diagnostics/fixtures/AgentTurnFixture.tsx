import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Terminal as XTerminal } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function AgentTurnApp() {
  const [content, setContent] = useState('# Agent Initializing...\n\nWaiting for execution.')
  const [ambient, setAmbient] = useState(false)
  const termRef = useRef<HTMLDivElement>(null)
  const xtermInstance = useRef<XTerminal | null>(null)
  const streamInterval = useRef<NodeJS.Timeout | null>(null)
  const terminalInterval = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!termRef.current || xtermInstance.current) return
    const term = new XTerminal({
      fontSize: 12,
      fontFamily: 'Consolas, monospace',
      scrollback: 5000,
      theme: { background: '#121214', foreground: '#e4e4e7' }
    })
    term.open(termRef.current)
    try {
      const webgl = new WebglAddon()
      term.loadAddon(webgl)
    } catch {
      // Fallback to canvas
    }
    term.write('Terminal ready.\r\n$ ')
    xtermInstance.current = term
  }, [])

  const startTokenStream = () => {
    let count = 0
    if (streamInterval.current) clearInterval(streamInterval.current)
    streamInterval.current = setInterval(() => {
      count++
      setContent(prev => prev + `\n\n### Step ${count}: Inspecting code structure\n\`\`\`typescript\nconst result_${count} = computeValue(${count}, "data_${count}")\nconsole.log(result_${count})\n\`\`\`\nToken streaming chunk **#${count}** with [link](file:///test/path) and *rich Markdown*.`)
    }, 25) // 40 chunks/sec
  }

  const stopTokenStream = () => {
    if (streamInterval.current) {
      clearInterval(streamInterval.current)
      streamInterval.current = null
    }
  }

  const startTerminalFlood = () => {
    if (terminalInterval.current) clearInterval(terminalInterval.current)
    let line = 0
    terminalInterval.current = setInterval(() => {
      const term = xtermInstance.current
      if (!term) return
      for (let i = 0; i < 20; i++) {
        line++
        term.write(`[INFO 2026-09-22 22:15:${(line % 60).toString().padStart(2, '0')}] Compiling module @adnify/core/chunk-${line}.ts (${(Math.random() * 100).toFixed(1)}ms) - 0 errors, 0 warnings\r\n`)
      }
    }, 30) // 20 lines every 30ms = ~660 lines/sec WebGL rendering
  }

  const stopTerminalFlood = () => {
    if (terminalInterval.current) {
      clearInterval(terminalInterval.current)
      terminalInterval.current = null
    }
  }

  const startFullAgentTurn = () => {
    setAmbient(true)
    startTokenStream()
    startTerminalFlood()
  }

  const stopAll = () => {
    setAmbient(false)
    stopTokenStream()
    stopTerminalFlood()
  }

  useEffect(() => {
    ;(window as any).__AGENT_TEST__ = {
      startTokenStream,
      stopTokenStream,
      startTerminalFlood,
      stopTerminalFlood,
      startFullAgentTurn,
      stopAll,
    }
  }, [])

  const corners = [
    { top: 0, left: 0, origin: 'top left' },
    { top: 0, right: 0, origin: 'top right' },
    { bottom: 0, left: 0, origin: 'bottom left' },
    { bottom: 0, right: 0, origin: 'bottom right' },
  ]

  return (
    <div className="relative w-screen h-screen bg-[#09090b] text-white flex flex-col overflow-hidden font-sans">
      {ambient && (
        <div className="absolute inset-0 pointer-events-none z-[1] overflow-hidden">
          {corners.map((c, i) => (
            <div
              key={i}
              className="absolute ambient-light--animated"
              style={{
                width: 550,
                height: 550,
                ...c,
                background: `radial-gradient(circle at ${c.origin}, rgba(59, 130, 246, 0.22) 0%, transparent 280px)`,
                animationDuration: '4s',
              }}
            />
          ))}
        </div>
      )}

      <div className="relative z-10 flex-1 grid grid-cols-2 gap-4 p-4 min-h-0">
        <div className="flex flex-col bg-zinc-900/90 border border-zinc-800 rounded-lg p-4 overflow-y-auto">
          <div className="text-xs font-mono text-zinc-500 mb-2">Agent Chat Stream View</div>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>

        <div className="flex flex-col bg-zinc-900/90 border border-zinc-800 rounded-lg p-4 min-h-0">
          <div className="text-xs font-mono text-zinc-500 mb-2">Agent Terminal (xterm + WebglAddon)</div>
          <div ref={termRef} className="flex-1 overflow-hidden" />
        </div>
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<AgentTurnApp />)
