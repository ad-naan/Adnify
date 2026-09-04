import { Parser } from 'htmlparser2'

/** Extract plain text for readers. The result is text, not sanitized HTML. */
export function htmlToText(html: string): string {
  const chunks: string[] = []
  const links: string[] = []
  let hiddenDepth = 0
  const parser = new Parser({
    onopentag(name, attributes) {
      if (hiddenDepth || name === 'script' || name === 'style') {
        hiddenDepth++
        return
      }
      if (name === 'br') chunks.push('\n')
      if (name === 'a') links.push(attributes.href ?? '')
    },
    ontext(text) {
      if (!hiddenDepth) chunks.push(text)
    },
    onclosetag(name) {
      if (hiddenDepth) {
        hiddenDepth--
        return
      }
      if (name === 'a') {
        const href = links.pop()
        if (href) chunks.push(` (${href})`)
      }
      if (name === 'p' || /^h[1-6]$/.test(name)) chunks.push('\n\n')
      else if (name === 'div' || name === 'li') chunks.push('\n')
    },
  })
  parser.end(html)
  return chunks.join('').replace(/\u00a0/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim()
}

/** Preserve entities here: Office readers decode them after extracting text. */
export function stripXmlTags(xml: string): string {
  const chunks: string[] = []
  const parser = new Parser({ ontext: text => chunks.push(text) }, { xmlMode: true, decodeEntities: false })
  parser.end(xml)
  return chunks.join('')
}
