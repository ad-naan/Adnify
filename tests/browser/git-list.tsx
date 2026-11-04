import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { GitFileList } from '../../src/renderer/components/git/GitFileList'
import { GitFileItem } from '../../src/renderer/components/git/GitFileItem'
import '../../src/renderer/styles/globals.css'

const paths = Array.from({ length: 5000 }, (_, index) => `src/features/feature-${index}/component.tsx`)
function Fixture() {
  const [parent, setParent] = useState<HTMLDivElement | null>(null)
  const [staged, setStaged] = useState<string[]>(paths.slice(0, 1000))
  const [changes, setChanges] = useState<string[]>(paths.slice(1000))
  const [expanded, setExpanded] = useState(true)
  const [opened, setOpened] = useState('')
  const [generation, setGeneration] = useState(0)
  return <main className="bg-background text-text-primary p-6" style={{ height: '100vh' }}>
    <div className="flex gap-3 mb-3">
      <button onClick={() => setExpanded(value => !value)}>Toggle staged</button>
      <button onClick={() => setGeneration(value => value + 1)}>Refresh</button>
      <button onClick={() => { setStaged(paths.slice(0, 2)); setChanges(paths.slice(2, 5)) }}>Small repository</button>
    </div>
    <output data-generation={generation}>{opened}</output>
    <div data-git-scroll ref={setParent} className="custom-scrollbar border border-border-subtle mt-3"
      style={{ height: 560, width: 420, overflowY: 'auto' }}>
      <div className="p-3 border-b border-border-subtle">Adnify / Source control</div>
      <div className="p-2 text-sm">Staged changes ({staged.length})</div>
      {expanded && <GitFileList items={staged} scrollParent={parent} getKey={path => path} renderItem={path => <GitFileItem
        path={path} status="modified" staged onClick={() => setOpened(path)}
        onUnstage={() => { setStaged(items => items.filter(item => item !== path)); setChanges(items => [path, ...items]) }}
      />} />}
      <div className="p-2 text-sm">Changes ({changes.length})</div>
      <GitFileList items={changes} scrollParent={parent} getKey={path => path} renderItem={path => <GitFileItem
        path={path} status="modified" staged={false} onClick={() => setOpened(path)}
        onStage={() => { setChanges(items => items.filter(item => item !== path)); setStaged(items => [...items, path]) }}
      />} />
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
