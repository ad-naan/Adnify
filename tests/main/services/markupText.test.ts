import { describe, expect, it } from 'vitest'
import { htmlToText, stripXmlTags } from '@main/services/markupText'

describe('markup text extraction', () => {
  it('preserves visible text, paragraph breaks, links and decoded entities', () => {
    expect(htmlToText('<h1>Title</h1><p>A &amp; B<br>C</p><a href="https://example.test/?a=1&amp;b=2"><b>Link</b></a>'))
      .toBe('Title\n\nA & B\nC\n\nLink (https://example.test/?a=1&b=2)')
  })

  it.each([
    '<script>secret</script\t\n bar><p>Visible</p>',
    '<style>secret</style ignored><p>Visible</p>',
    '<!-- secret --><p title="a > b">Visible</p>',
  ])('handles malformed tags without leaking hidden content: %s', markup => {
    expect(htmlToText(markup)).toBe('Visible')
  })

  it('does not reparse decoded entities or splice text into new tags', () => {
    expect(htmlToText('&lt;script&gt;literal&lt;/script&gt;')).toBe('<script>literal</script>')
    expect(htmlToText('<scr<!--x-->ipt>text')).not.toContain('<script>')
    expect(htmlToText('<p>Visible</p><script>unterminated')).toBe('Visible')
  })

  it('extracts XML text with quoted angle brackets, comments, CDATA and entities', () => {
    expect(stripXmlTags('<w:t label="a > b">A &amp; B</w:t><!-- hidden --><![CDATA[<literal>]]>'))
      .toBe('A &amp; B<literal>')
  })
})
