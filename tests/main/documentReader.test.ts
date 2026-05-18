import { afterEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

const ONE_BY_ONE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sXn0xQAAAAASUVORK5CYII='

afterEach(() => {
  vi.restoreAllMocks()
})

async function importReader() {
  vi.resetModules()
  return await import('@main/services/documentReader/richContentReader')
}

async function createTempFile(fileName: string, data: Buffer | string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'adnify-doc-reader-'))
  const filePath = path.join(dir, fileName)
  await fs.writeFile(filePath, data)
  return { dir, filePath }
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function createSimplePdfBuffer(text: string): Buffer {
  const stream = `BT\n/F1 18 Tf\n72 120 Td\n(${escapePdfText(text)}) Tj\nET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += object
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, 'utf8')
}

async function createDocxBuffer(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('word/document.xml', `
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>Body paragraph</w:t></w:r></w:p>
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:r><w:t>Cell A1</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>Cell B1</w:t></w:r></w:p></w:tc>
          </w:tr>
        </w:tbl>
      </w:body>
    </w:document>
  `)
  zip.file('word/header1.xml', `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>`)
  zip.file('word/footer1.xml', `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Footer text</w:t></w:r></w:p></w:ftr>`)
  zip.file('word/media/image1.png', Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'))
  return await zip.generateAsync({ type: 'nodebuffer' })
}

async function createPptxBuffer(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('ppt/slides/slide1.xml', `
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld>
        <p:spTree>
          <p:sp>
            <p:txBody>
              <a:p><a:r><a:t>Slide title</a:t></a:r></a:p>
              <a:p><a:r><a:t>Slide bullet</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>
        </p:spTree>
      </p:cSld>
    </p:sld>
  `)
  zip.file('ppt/media/image1.png', Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'))
  return await zip.generateAsync({ type: 'nodebuffer' })
}

async function createXlsxBuffer(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('xl/workbook.xml', `
    <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>
        <sheet name="Summary" sheetId="1" r:id="rId1"/>
      </sheets>
    </workbook>
  `)
  zip.file('xl/_rels/workbook.xml.rels', `
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    </Relationships>
  `)
  zip.file('xl/sharedStrings.xml', `
    <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <si><t>Quarter</t></si>
      <si><t>Revenue</t></si>
    </sst>
  `)
  zip.file('xl/worksheets/sheet1.xml', `
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">
          <c r="A1" t="s"><v>0</v></c>
          <c r="B1" t="s"><v>1</v></c>
        </row>
        <row r="2">
          <c r="A2" t="str"><v>Q1</v></c>
          <c r="B2"><v>42</v></c>
        </row>
      </sheetData>
    </worksheet>
  `)
  zip.file('xl/media/image1.png', Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'))
  return await zip.generateAsync({ type: 'nodebuffer' })
}

describe('richContentReader', () => {
  it('extracts PDF text', async () => {
    vi.doMock('pdf-parse', () => ({
      default: vi.fn(async () => ({ text: 'Hello PDF Reader' })),
    }))
    const { readRichContent } = await importReader()
    const pdfBuffer = createSimplePdfBuffer('Hello PDF Reader')
    const { filePath, dir } = await createTempFile('sample.pdf', pdfBuffer)

    try {
      const result = await readRichContent(filePath)
      expect(result.success).toBe(true)
      expect(result.contentKind).toBe('document')
      expect(result.content).toContain('Hello PDF Reader')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
      vi.doUnmock('pdf-parse')
    }
  })

  it('extracts DOCX content and analyzes embedded images', async () => {
    const { readRichContent } = await importReader()
    const buffer = await createDocxBuffer()
    const { filePath, dir } = await createTempFile('sample.docx', buffer)

    try {
      const result = await readRichContent(filePath, {
        embeddedImageAnalyzer: async (image) => `OCR for ${image.displayName}`,
      })
      expect(result.success).toBe(true)
      expect(result.content).toContain('Body paragraph')
      expect(result.content).toContain('Header 1')
      expect(result.content).toContain('Footer 1')
      expect(result.content).toContain('Table 1')
      expect(result.content).toContain('Embedded image 1')
      expect(result.embeddedImageCount).toBe(1)
      expect(result.embeddedImagesAnalyzed).toBe(1)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('notes skipped embedded-image analysis when no multimodal model is configured', async () => {
    const { readRichContent } = await importReader()
    const buffer = await createDocxBuffer()
    const { filePath, dir } = await createTempFile('skip-images.docx', buffer)

    try {
      const result = await readRichContent(filePath, {
        skipImageAnalysisReason: 'no multimodal model configured',
      })
      expect(result.success).toBe(true)
      expect(result.content).toContain('Embedded images were not analyzed')
      expect(result.imageAnalysisSkippedReason).toBe('no multimodal model configured')
      expect(result.embeddedImageCount).toBe(1)
      expect(result.embeddedImagesAnalyzed).toBe(0)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('extracts PPTX slide text and embedded-image analyses', async () => {
    const { readRichContent } = await importReader()
    const buffer = await createPptxBuffer()
    const { filePath, dir } = await createTempFile('sample.pptx', buffer)

    try {
      const result = await readRichContent(filePath, {
        embeddedImageAnalyzer: async () => 'Detected chart legend and title',
      })
      expect(result.success).toBe(true)
      expect(result.content).toContain('Slide 1')
      expect(result.content).toContain('Slide title')
      expect(result.content).toContain('Detected chart legend and title')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('extracts XLSX sheet rows and embedded-image analyses', async () => {
    const { readRichContent } = await importReader()
    const buffer = await createXlsxBuffer()
    const { filePath, dir } = await createTempFile('sample.xlsx', buffer)

    try {
      const result = await readRichContent(filePath, {
        embeddedImageAnalyzer: async () => 'Detected worksheet screenshot',
      })
      expect(result.success).toBe(true)
      expect(result.content).toContain('Sheet: Summary')
      expect(result.content).toContain('Row 1: Quarter | Revenue')
      expect(result.content).toContain('Row 2: Q1 | 42')
      expect(result.content).toContain('Detected worksheet screenshot')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('uses best-effort legacy Office fallback when a system extractor succeeds', async () => {
    vi.doMock('node:child_process', () => ({
      execFile: (_command: string, _args: string[], callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, 'Legacy extracted text', '')
      },
    }))
    const { readRichContent } = await importReader()
    const { filePath, dir } = await createTempFile('legacy.doc', 'placeholder')

    try {
      const result = await readRichContent(filePath)
      expect(result.success).toBe(true)
      expect(result.usedFallback).toBe(true)
      expect(result.content).toContain('Legacy extracted text')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
      vi.doUnmock('node:child_process')
    }
  })

  it('returns a conversion hint when legacy Office fallback fails', async () => {
    vi.doMock('node:child_process', () => ({
      execFile: (_command: string, _args: string[], callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(new Error('extractor missing'), '', '')
      },
    }))
    const { readRichContent } = await importReader()
    const { filePath, dir } = await createTempFile('legacy.xls', 'placeholder')

    try {
      const result = await readRichContent(filePath)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Unsupported legacy Office file type .xls')
      expect(result.error).toContain('convert it to xlsx')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
      vi.doUnmock('node:child_process')
    }
  })
})
