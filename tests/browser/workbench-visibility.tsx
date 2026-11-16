import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import DockWorkbench from '@renderer/components/layout/DockWorkbench'
import { createWorkbenchLayout, WORKBENCH_PANELS, type WorkbenchPanel } from '@renderer/components/layout/workbenchLayout'
import SmoothCollapse from '@renderer/components/agent/SmoothCollapse'
import '../../src/renderer/styles/globals.css'

function Fixture() {
  const [layout, setLayout] = useState(createWorkbenchLayout())
  const [visible, setVisible] = useState<WorkbenchPanel[]>([...WORKBENCH_PANELS])
  const [focused, setFocused] = useState<WorkbenchPanel | null>(null)
  const [terminalVisible, setTerminalVisible] = useState(true)
  return <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <nav style={{ display: 'flex', gap: 16 }}>
      {WORKBENCH_PANELS.map(panel => <button key={panel} onClick={() => setVisible(current => current.includes(panel) ? current.filter(item => item !== panel) : [...current, panel])}>Toggle {panel}</button>)}
      <button onClick={() => setFocused(current => current ? null : 'agent')}>Focus agent</button>
      <button onClick={() => setTerminalVisible(current => !current)}>Toggle terminal</button>
    </nav>
    <DockWorkbench layout={layout} visible={visible} focused={focused} language="en" onLayoutChange={setLayout}
      panels={Object.fromEntries(WORKBENCH_PANELS.map(panel => [panel,
        // Open disclosures explicitly restore visibility, as do embedded editor widgets.
        <SmoothCollapse open animateInitial={false}>
          <div data-panel-probe={panel} style={{ visibility: 'visible', pointerEvents: 'auto', padding: 8 }}>
            <textarea aria-label={`${panel} draft`} defaultValue={`${panel} saved text`} />
            <div data-scroll={panel} style={{ overflow: 'auto', height: 100 }}><div style={{ height: 1000 }}>Long panel content</div></div>
            <canvas width={120} height={100} ref={node => { const context = node?.getContext('2d'); if (context) { context.fillStyle = '#16a34a'; context.fillRect(0, 0, 120, 100) } }} />
          </div>
        </SmoothCollapse>,
      ])) as Record<WorkbenchPanel, React.ReactNode>}
      terminalVisible={terminalVisible}
      terminal={<div data-panel-probe="terminal" style={{ visibility: 'visible', pointerEvents: 'auto' }}><textarea aria-label="terminal draft" defaultValue="running session" /></div>}
    />
  </main>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
