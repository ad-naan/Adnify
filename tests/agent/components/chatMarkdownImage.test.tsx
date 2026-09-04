import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMarkdownImage } from '@renderer/components/agent/ChatMarkdownImage'

const state = vi.hoisted(() => ({ value: undefined as unknown, workspacePath: '/project', effect: undefined as (() => () => void) | undefined }))
const resolveImage = vi.hoisted(() => vi.fn())
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: () => [state.value, (value: unknown) => { state.value = value }],
  useEffect: (effect: () => () => void) => { state.effect = effect },
}))
vi.mock('@store', () => ({ useStore: (select: (value: unknown) => unknown) => select({ language: 'en', workspacePath: state.workspacePath }) }))
vi.mock('@renderer/services/chatImageSource', () => ({ resolveChatImageSource: resolveImage }))

beforeEach(() => {
  state.value = undefined
  state.workspacePath = '/project'
  state.effect = undefined
  resolveImage.mockReset()
})
const render = (src = 'asset://image-1') => ChatMarkdownImage({ src, alt: 'Poster' })
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

describe('chat Markdown image lifecycle', () => {
  it('renders resolved preview data, never the asset or filesystem reference in a native image', async () => {
    resolveImage.mockResolvedValue('data:image/webp;base64,WA==')
    expect(render().type).toBe('span')
    state.effect!()
    await flush()
    const result = render()
    expect(result.type).toBe('img')
    expect(result.props.src).toBe('data:image/webp;base64,WA==')
    expect(result.props.alt).toBe('Poster')
  })

  it('replaces network/decode failures with readable text, not a broken image icon', async () => {
    resolveImage.mockResolvedValue('https://example.test/missing.png')
    render(); state.effect!(); await flush()
    render().props.onError()
    expect(render().type).toBe('span')
    expect(render().props.children).toContain('Image could not be loaded')
  })

  it('shows the same fallback when the file or asset cannot be loaded', async () => {
    resolveImage.mockRejectedValue(new Error('missing'))
    render(); state.effect!(); await flush()
    expect(render().props.children).toContain('Image could not be loaded')
  })

  it('ignores an in-flight result after unmount and hides stale images on source/workspace changes', async () => {
    let finish!: (url: string) => void
    resolveImage.mockImplementation(() => new Promise<string>(resolve => { finish = resolve }))
    render()
    const cleanup = state.effect!()
    cleanup()
    finish('data:image/webp;base64,WA==')
    await flush()
    expect(render().type).toBe('span')
    resolveImage.mockResolvedValue('data:image/webp;base64,WA==')
    render(); state.effect!(); await flush()
    expect(render().type).toBe('img')
    expect(render('asset://image-2').type).toBe('span')
    state.workspacePath = '/other-project'
    expect(render().type).toBe('span')
  })
})
