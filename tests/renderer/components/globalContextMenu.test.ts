import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { getEditableTarget, insertTextIntoElement } from '@renderer/components/common/GlobalContextMenu'

describe('GlobalContextMenu - getEditableTarget', () => {
  let originalHTMLElement: unknown
  let originalHTMLInputElement: unknown
  let originalHTMLTextAreaElement: unknown

  class FakeHTMLElement extends EventTarget {
    contentEditable = 'inherit'
    parentElement: FakeHTMLElement | null = null
    getAttribute(attr: string) {
      if (attr === 'contenteditable') return this.contentEditable
      return null
    }
    closest(selector: string): FakeHTMLElement | null {
      if (selector.includes('contenteditable') && (this.contentEditable === 'true' || this.contentEditable === '')) {
        return this
      }
      return this.parentElement ? this.parentElement.closest(selector) : null
    }
  }

  class FakeHTMLInputElement extends FakeHTMLElement {
    type = 'text'
    value = ''
    selectionStart = 0
    selectionEnd = 0
    readOnly = false
    disabled = false
  }

  class FakeHTMLTextAreaElement extends FakeHTMLElement {
    value = ''
    selectionStart = 0
    selectionEnd = 0
    readOnly = false
    disabled = false
  }

  beforeEach(() => {
    originalHTMLElement = globalThis.HTMLElement
    originalHTMLInputElement = globalThis.HTMLInputElement
    originalHTMLTextAreaElement = globalThis.HTMLTextAreaElement

    globalThis.HTMLElement = FakeHTMLElement as any
    globalThis.HTMLInputElement = FakeHTMLInputElement as any
    globalThis.HTMLTextAreaElement = FakeHTMLTextAreaElement as any
  })

  afterEach(() => {
    globalThis.HTMLElement = originalHTMLElement as any
    globalThis.HTMLInputElement = originalHTMLInputElement as any
    globalThis.HTMLTextAreaElement = originalHTMLTextAreaElement as any
  })

  it('identifies standard text input elements as editable', () => {
    const input = new FakeHTMLInputElement()
    input.type = 'text'
    expect(getEditableTarget(input)).toBe(input)

    const searchInput = new FakeHTMLInputElement()
    searchInput.type = 'search'
    expect(getEditableTarget(searchInput)).toBe(searchInput)

    const passwordInput = new FakeHTMLInputElement()
    passwordInput.type = 'password'
    expect(getEditableTarget(passwordInput)).toBe(passwordInput)
  })

  it('identifies textarea elements as editable', () => {
    const textarea = new FakeHTMLTextAreaElement()
    expect(getEditableTarget(textarea)).toBe(textarea)
  })

  it('identifies contenteditable elements as editable', () => {
    const div = new FakeHTMLElement()
    div.contentEditable = 'true'
    const span = new FakeHTMLElement()
    span.parentElement = div

    expect(getEditableTarget(div)).toBe(div)
    expect(getEditableTarget(span)).toBe(div)
  })

  it('rejects non-text input types and non-editable elements', () => {
    const button = new FakeHTMLInputElement()
    button.type = 'button'
    expect(getEditableTarget(button)).toBeNull()

    const checkbox = new FakeHTMLInputElement()
    checkbox.type = 'checkbox'
    expect(getEditableTarget(checkbox)).toBeNull()

    const file = new FakeHTMLInputElement()
    file.type = 'file'
    expect(getEditableTarget(file)).toBeNull()

    const plainDiv = new FakeHTMLElement()
    expect(getEditableTarget(plainDiv)).toBeNull()

    expect(getEditableTarget(null)).toBeNull()
  })
})

describe('GlobalContextMenu - insertTextIntoElement', () => {
  let originalHTMLElement: unknown
  let originalHTMLInputElement: unknown
  let originalHTMLTextAreaElement: unknown
  let originalDocument: unknown

  class MockInputElement {
    type = 'text'
    private _val = ''
    get value() { return this._val }
    set value(v: string) { this._val = v }
    selectionStart = 0
    selectionEnd = 0
    listeners: Record<string, Array<() => void>> = {}

    focus() {}
    setSelectionRange(start: number, end: number) {
      this.selectionStart = start
      this.selectionEnd = end
    }
    addEventListener(event: string, fn: () => void) {
      this.listeners[event] = this.listeners[event] || []
      this.listeners[event].push(fn)
    }
    dispatchEvent(event: { type: string }) {
      this.listeners[event.type]?.forEach(fn => fn())
      return true
    }
  }

  beforeEach(() => {
    originalHTMLElement = globalThis.HTMLElement
    originalHTMLInputElement = globalThis.HTMLInputElement
    originalHTMLTextAreaElement = globalThis.HTMLTextAreaElement
    originalDocument = globalThis.document

    globalThis.HTMLElement = MockInputElement as any
    globalThis.HTMLInputElement = MockInputElement as any
    globalThis.HTMLTextAreaElement = MockInputElement as any
    globalThis.document = {
      execCommand: vi.fn(() => false), // simulate fallback
    } as any
  })

  afterEach(() => {
    globalThis.HTMLElement = originalHTMLElement as any
    globalThis.HTMLInputElement = originalHTMLInputElement as any
    globalThis.HTMLTextAreaElement = originalHTMLTextAreaElement as any
    globalThis.document = originalDocument as any
  })

  it('inserts text at cursor and dispatches input/change events on input', () => {
    const input = new MockInputElement()
    input.value = 'hello world'
    input.setSelectionRange(6, 11)

    let inputFired = false
    let changeFired = false
    input.addEventListener('input', () => { inputFired = true })
    input.addEventListener('change', () => { changeFired = true })

    insertTextIntoElement(input as any, 'Adnify')

    expect(input.value).toBe('hello Adnify')
    expect(inputFired).toBe(true)
    expect(changeFired).toBe(true)
    expect(input.selectionStart).toBe(12)
    expect(input.selectionEnd).toBe(12)
  })

  it('deletes selection when empty string is inserted', () => {
    const textarea = new MockInputElement()
    textarea.value = '123456'
    textarea.setSelectionRange(2, 4) // select "34"

    let inputFired = false
    textarea.addEventListener('input', () => { inputFired = true })

    insertTextIntoElement(textarea as any, '')

    expect(textarea.value).toBe('1256')
    expect(inputFired).toBe(true)
    expect(textarea.selectionStart).toBe(2)
    expect(textarea.selectionEnd).toBe(2)
  })
})
