import { execFile as execFileCallback } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type JSZip from 'jszip'
import type {
  DocumentReaderEmbeddedImage,
  RichContentReadResult,
} from '@shared/types'

type PdfParse = (data: Buffer) => Promise<{ text?: string }>

let jsZipLoader: Promise<typeof JSZip> | undefined
let pdfParseLoader: Promise<PdfParse> | undefined

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'])
const OOXML_DOCUMENT_EXTENSIONS = new Set(['docx', 'pptx', 'xlsx'])
const LEGACY_OFFICE_EXTENSIONS = new Set(['doc', 'ppt', 'xls'])
const RICH_DOCUMENT_EXTENSIONS = new Set(['pdf', ...OOXML_DOCUMENT_EXTENSIONS, ...LEGACY_OFFICE_EXTENSIONS])
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'xml', 'html', 'htm', 'css', 'scss', 'less',
  'js', 'jsx', 'ts', 'tsx', 'kt', 'kts', 'java', 'py', 'rb', 'go', 'rs', 'c', 'cc', 'cpp',
  'h', 'hpp', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'properties',
  'gradle', 'sql', 'csv', 'log'
])
const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

export interface ReadRichContentInternalOptions {
  embeddedImageAnalyzer?: (image: DocumentReaderEmbeddedImage) => Promise<string>
  skipImageAnalysisReason?: string
}

interface RichReadContentPayload {
  content: string
  usedFallback?: boolean
  embeddedImageCount: number
  embeddedImagesAnalyzed: number
  imageAnalysisSkippedReason?: string
}

export interface FileReadFailureOptions {
  expectedFormat?: string
  stage?: string
}

export function isRichDocumentPath(targetPath: string): boolean {
  return RICH_DOCUMENT_EXTENSIONS.has(extensionOf(targetPath))
}

export function isImagePath(targetPath: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(targetPath))
}

export async function readRichContent(
  targetPath: string,
  options: ReadRichContentInternalOptions = {},
): Promise<RichContentReadResult> {
  const absolutePath = path.resolve(targetPath)
  const stat = await fs.stat(absolutePath).catch(() => null)
  if (!stat?.isFile()) {
    return {
      success: false,
      error: `Error: File not found at ${absolutePath}`,
      contentKind: 'unknown',
      sourceFormat: extensionOf(absolutePath) || 'unknown',
    }
  }

  const extension = extensionOf(absolutePath)
  try {
    if (IMAGE_EXTENSIONS.has(extension)) {
      return {
        success: false,
        error: 'Error: This file is an image. Use read_image instead.',
        contentKind: 'image',
        sourceFormat: extension || 'image',
      }
    }
    if (extension === 'pdf') {
      const payload = await readPdf(absolutePath)
      return {
        success: true,
        content: payload.content,
        contentKind: 'document',
        sourceFormat: extension,
        usedFallback: payload.usedFallback,
        embeddedImageCount: payload.embeddedImageCount,
        embeddedImagesAnalyzed: payload.embeddedImagesAnalyzed,
      }
    }
    if (extension === 'docx') {
      const payload = await readDocx(absolutePath, options)
      return toResult(payload, extension)
    }
    if (extension === 'pptx') {
      const payload = await readPptx(absolutePath, options)
      return toResult(payload, extension)
    }
    if (extension === 'xlsx') {
      const payload = await readXlsx(absolutePath, options)
      return toResult(payload, extension)
    }
    if (LEGACY_OFFICE_EXTENSIONS.has(extension)) {
      const extracted = await readWithSystemTextExtractors(absolutePath)
      if (extracted) {
        return {
          success: true,
          content: withHeader(absolutePath, extracted),
          contentKind: 'document',
          sourceFormat: extension,
          usedFallback: true,
          embeddedImageCount: 0,
          embeddedImagesAnalyzed: 0,
        }
      }
      return {
        success: false,
        error: `Error: Unsupported legacy Office file type .${extension} on this machine. Please convert it to ${
          extension === 'doc' ? 'docx' : extension === 'ppt' ? 'pptx' : 'xlsx'
        } or install a system text extractor.`,
        contentKind: 'document',
        sourceFormat: extension,
        usedFallback: true,
      }
    }
    if (TEXT_EXTENSIONS.has(extension)) {
      return {
        success: true,
        content: await fs.readFile(absolutePath, 'utf8'),
        contentKind: 'text',
        sourceFormat: extension || 'text',
      }
    }

    const buffer = await fs.readFile(absolutePath)
    if (looksLikeText(buffer)) {
      return {
        success: true,
        content: buffer.toString('utf8'),
        contentKind: 'text',
        sourceFormat: extension || 'text',
      }
    }
    return {
      success: false,
      error: `Error: Unsupported file type .${extension || 'unknown'}. Supported rich document formats include pdf, doc/docx, ppt/pptx, xls/xlsx, and common text files.`,
      contentKind: 'unknown',
      sourceFormat: extension || 'unknown',
    }
  } catch (error) {
    return {
      success: false,
      error: await describeFileReadFailure(absolutePath, error, {
        expectedFormat: describeExpectedFormat(extension),
        stage: describeFailureStage(extension),
      }),
      contentKind: isRichDocumentPath(absolutePath) ? 'document' : 'unknown',
      sourceFormat: extension || 'unknown',
    }
  }
}

function toResult(payload: RichReadContentPayload, sourceFormat: string): RichContentReadResult {
  return {
    success: true,
    content: payload.content,
    contentKind: 'document',
    sourceFormat,
    usedFallback: payload.usedFallback,
    embeddedImageCount: payload.embeddedImageCount,
    embeddedImagesAnalyzed: payload.embeddedImagesAnalyzed,
    imageAnalysisSkippedReason: payload.imageAnalysisSkippedReason,
  }
}

async function readPdf(absolutePath: string): Promise<RichReadContentPayload> {
  const buffer = await fs.readFile(absolutePath)
  try {
    const pdfParse = await loadPdfParse()
    const parsed = await pdfParse(buffer)
    const text = normalizeWhitespaceBlock(parsed.text ?? '')
    if (!text) {
      const fallback = await readWithSystemTextExtractors(absolutePath)
      if (fallback) {
        return {
          content: withHeader(absolutePath, fallback),
          usedFallback: true,
          embeddedImageCount: 0,
          embeddedImagesAnalyzed: 0,
        }
      }
    }
    return {
      content: withHeader(absolutePath, text || '(PDF contains no extractable text.)'),
      embeddedImageCount: 0,
      embeddedImagesAnalyzed: 0,
    }
  } catch {
    const fallback = await readWithSystemTextExtractors(absolutePath)
    if (fallback) {
      return {
        content: withHeader(absolutePath, fallback),
        usedFallback: true,
        embeddedImageCount: 0,
        embeddedImagesAnalyzed: 0,
      }
    }
    throw new Error('Unable to extract PDF content')
  }
}

async function readDocx(
  absolutePath: string,
  options: ReadRichContentInternalOptions,
): Promise<RichReadContentPayload> {
  const zip = await loadZip(absolutePath)
  const sections: string[] = []
  const tableCounter = { value: 0 }

  const body = await readZipText(zip, 'word/document.xml')
  if (body) {
    const content = renderDocxBody(body, tableCounter)
    if (content) {
      sections.push(content)
    }
  }

  const headerEntries = Object.keys(zip.files)
    .filter((name) => /^word\/header\d+\.xml$/i.test(name))
    .sort(compareNaturalPath)
  for (let index = 0; index < headerEntries.length; index += 1) {
    const headerXml = await readZipText(zip, headerEntries[index])
    const content = renderDocxBody(headerXml, tableCounter)
    if (content) {
      sections.push(`Header ${index + 1}:\n${content}`)
    }
  }

  const footerEntries = Object.keys(zip.files)
    .filter((name) => /^word\/footer\d+\.xml$/i.test(name))
    .sort(compareNaturalPath)
  for (let index = 0; index < footerEntries.length; index += 1) {
    const footerXml = await readZipText(zip, footerEntries[index])
    const content = renderDocxBody(footerXml, tableCounter)
    if (content) {
      sections.push(`Footer ${index + 1}:\n${content}`)
    }
  }

  const imageOutput = await buildEmbeddedImageSections(
    zip,
    'word/media/',
    options,
    'document image',
  )
  sections.push(...imageOutput.sections)
  return {
    content: withHeader(absolutePath, sections.join('\n\n') || '(Document contains no extractable text.)'),
    embeddedImageCount: imageOutput.total,
    embeddedImagesAnalyzed: imageOutput.analyzed,
    imageAnalysisSkippedReason: imageOutput.skippedReason,
  }
}

async function readPptx(
  absolutePath: string,
  options: ReadRichContentInternalOptions,
): Promise<RichReadContentPayload> {
  const zip = await loadZip(absolutePath)
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(compareNaturalPath)

  const sections: string[] = []
  for (let index = 0; index < slideEntries.length; index += 1) {
    const xml = await readZipText(zip, slideEntries[index])
    const text = extractPptxSlideText(xml)
    sections.push(`Slide ${index + 1}:\n${text || '(Slide contains no extractable text.)'}`)
  }

  const imageOutput = await buildEmbeddedImageSections(
    zip,
    'ppt/media/',
    options,
    'presentation image',
  )
  sections.push(...imageOutput.sections)
  return {
    content: withHeader(absolutePath, sections.join('\n\n') || '(Presentation contains no extractable text.)'),
    embeddedImageCount: imageOutput.total,
    embeddedImagesAnalyzed: imageOutput.analyzed,
    imageAnalysisSkippedReason: imageOutput.skippedReason,
  }
}

async function readXlsx(
  absolutePath: string,
  options: ReadRichContentInternalOptions,
): Promise<RichReadContentPayload> {
  const zip = await loadZip(absolutePath)
  const sharedStrings = await readSharedStrings(zip)
  const sheetEntries = await readWorkbookSheetEntries(zip)
  const sections: string[] = []

  for (const sheetEntry of sheetEntries) {
    const xml = await readZipText(zip, sheetEntry.xmlPath)
    const rows = renderWorksheetRows(xml, sharedStrings)
    sections.push(`Sheet: ${sheetEntry.name}\n${rows.join('\n') || '(Sheet is empty.)'}`)
  }

  const imageOutput = await buildEmbeddedImageSections(
    zip,
    'xl/media/',
    options,
    'worksheet image',
  )
  sections.push(...imageOutput.sections)
  return {
    content: withHeader(absolutePath, sections.join('\n\n') || '(Workbook contains no sheets.)'),
    embeddedImageCount: imageOutput.total,
    embeddedImagesAnalyzed: imageOutput.analyzed,
    imageAnalysisSkippedReason: imageOutput.skippedReason,
  }
}

async function buildEmbeddedImageSections(
  zip: JSZip,
  prefix: string,
  options: ReadRichContentInternalOptions,
  labelPrefix: string,
): Promise<{ sections: string[]; total: number; analyzed: number; skippedReason?: string }> {
  const images = await readEmbeddedImages(zip, prefix, labelPrefix)
  if (images.length === 0) {
    return { sections: [], total: 0, analyzed: 0 }
  }

  if (!options.embeddedImageAnalyzer) {
    return {
      sections: options.skipImageAnalysisReason
        ? [`Embedded images were not analyzed: ${options.skipImageAnalysisReason}`]
        : [],
      total: images.length,
      analyzed: 0,
      skippedReason: options.skipImageAnalysisReason,
    }
  }

  const sections: string[] = []
  let analyzed = 0
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]
    const analysis = (await options.embeddedImageAnalyzer(image)).trim()
    if (!analysis) {
      continue
    }
    analyzed += 1
    sections.push(`Embedded image ${index + 1} (${image.displayName}):\n${analysis}`)
  }

  return {
    sections,
    total: images.length,
    analyzed,
  }
}

async function readEmbeddedImages(
  zip: JSZip,
  prefix: string,
  labelPrefix: string,
): Promise<DocumentReaderEmbeddedImage[]> {
  const entries = Object.keys(zip.files)
    .filter((name) => name.startsWith(prefix) && IMAGE_EXTENSIONS.has(extensionOf(name)))
    .sort(compareNaturalPath)

  const images: DocumentReaderEmbeddedImage[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const file = zip.file(entry)
    const bytes = file ? await file.async('nodebuffer') : undefined
    if (!bytes) {
      continue
    }
    const extension = extensionOf(entry)
    const mimeType = MIME_TYPES[extension]
    if (!mimeType) {
      continue
    }
    images.push({
      displayName: `${labelPrefix} ${index + 1} (${path.posix.basename(entry)})`,
      mimeType,
      data: bytes.toString('base64'),
    })
  }
  return images
}

async function loadZip(absolutePath: string): Promise<JSZip> {
  const buffer = await fs.readFile(absolutePath)
  const JSZip = await loadJsZip()
  return await JSZip.loadAsync(buffer)
}

async function loadJsZip(): Promise<typeof JSZip> {
  jsZipLoader ??= import('jszip')
    .then((module) => module.default)
    .catch((error) => {
      throw createDependencyLoadError('jszip', error)
    })
  return await jsZipLoader
}

async function loadPdfParse(): Promise<PdfParse> {
  pdfParseLoader ??= Promise.resolve()
    .then(() => {
      const pdfParse = require('pdf-parse') as unknown
      if (typeof pdfParse !== 'function') {
        throw new Error('pdf-parse did not export a parser function')
      }
      return pdfParse as PdfParse
    })
    .catch((error) => {
      throw createDependencyLoadError('pdf-parse', error)
    })
  return await pdfParseLoader
}

async function readZipText(zip: JSZip, fileName: string): Promise<string> {
  const file = zip.file(fileName)
  if (!file) {
    return ''
  }
  return await file.async('string')
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const xml = await readZipText(zip, 'xl/sharedStrings.xml')
  if (!xml) {
    return []
  }
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
    .map((match) => extractSpreadsheetInlineText(match[1]))
    .map((item) => item.trim())
}

async function readWorkbookSheetEntries(zip: JSZip): Promise<Array<{ name: string; xmlPath: string }>> {
  const workbookXml = await readZipText(zip, 'xl/workbook.xml')
  if (!workbookXml) {
    return fallbackSheetEntries(zip)
  }
  const relsXml = await readZipText(zip, 'xl/_rels/workbook.xml.rels')
  const relationMap = new Map<string, string>()
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g)) {
    relationMap.set(match[1], normalizeZipPath(path.posix.join('xl', match[2])))
  }

  const entries = [...workbookXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/?>/g)]
    .map((match) => {
      const relationTarget = relationMap.get(match[2])
      return relationTarget
        ? {
            name: decodeXmlEntities(match[1]).trim() || path.posix.basename(relationTarget),
            xmlPath: relationTarget,
          }
        : null
    })
    .filter((item): item is { name: string; xmlPath: string } => item !== null)

  return entries.length > 0 ? entries : fallbackSheetEntries(zip)
}

function fallbackSheetEntries(zip: JSZip): Array<{ name: string; xmlPath: string }> {
  return Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort(compareNaturalPath)
    .map((xmlPath, index) => ({
      name: `Sheet${index + 1}`,
      xmlPath,
    }))
}

function renderDocxBody(xml: string, tableCounter: { value: number }): string {
  if (!xml) {
    return ''
  }
  const bodyMatch = xml.match(/<w:body\b[\s\S]*?>([\s\S]*?)<\/w:body>/)
  const body = bodyMatch?.[1] ?? xml
  const blockRegex = /<(w:p|w:tbl)\b[\s\S]*?<\/\1>/g
  const sections: string[] = []
  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(body)) !== null) {
    if (match[1] === 'w:p') {
      const text = extractDocxParagraphText(match[0])
      if (text) {
        sections.push(text)
      }
    } else {
      tableCounter.value += 1
      const tableText = renderDocxTable(match[0], tableCounter.value)
      if (tableText) {
        sections.push(tableText)
      }
    }
  }
  return sections.join('\n\n')
}

function extractDocxParagraphText(xml: string): string {
  const text = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
  const parts = extractTaggedText(text, ['w:t', 'w:delText', 'w:instrText'])
  return normalizeParagraphText(parts.join(''))
}

function renderDocxTable(xml: string, tableNumber: number): string {
  const rows = [...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((match) => match[0])
  if (rows.length === 0) {
    return `Table ${tableNumber}:\n(Empty table)`
  }
  const renderedRows = rows
    .map((rowXml) => [...rowXml.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cellMatch) => {
      const cellParagraphs = [...cellMatch[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
        .map((paragraphMatch) => extractDocxParagraphText(paragraphMatch[0]))
        .filter(Boolean)
      return cellParagraphs.join(' ⏎ ').trim()
    }))
    .filter((cells) => cells.some((cell) => cell.length > 0))

  if (renderedRows.length === 0) {
    return `Table ${tableNumber}:\n(Empty table)`
  }

  const columnCount = Math.max(...renderedRows.map((cells) => cells.length))
  const lines = renderedRows.map((cells, index) => `Row ${index + 1}: ${cells.join(' | ').trimEnd()}`)
  return `Table ${tableNumber}:\nColumns: ${columnCount}\n${lines.join('\n')}`
}

function extractPptxSlideText(xml: string): string {
  const paragraphs = [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)]
    .map((match) => {
      const paragraph = match[0].replace(/<a:br\b[^>]*\/>/g, '\n')
      return normalizeParagraphText(extractTaggedText(paragraph, ['a:t']).join(''))
    })
    .filter(Boolean)
  return paragraphs.join('\n')
}

function renderWorksheetRows(xml: string, sharedStrings: string[]): string[] {
  const rowMatches = [...xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)]
  const rows: string[] = []
  for (const match of rowMatches) {
    const rowNumber = Number(extractAttribute(match[1], 'r') || rows.length + 1)
    const cells = parseWorksheetCells(match[2], sharedStrings)
    if (cells.length === 0 || cells.every((cell) => cell.length === 0)) {
      continue
    }
    rows.push(`Row ${rowNumber}: ${cells.join(' | ').trimEnd()}`)
  }
  return rows
}

function parseWorksheetCells(rowXml: string, sharedStrings: string[]): string[] {
  const cellMatches = [...rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)]
  if (cellMatches.length === 0) {
    return []
  }

  const positionedCells = cellMatches.map((match) => {
    const attributes = match[1]
    const cellXml = match[2]
    const ref = extractAttribute(attributes, 'r')
    const type = extractAttribute(attributes, 't')
    const columnIndex = ref ? columnIndexFromCellRef(ref) : -1
    const value = normalizeWorksheetCellValue(type, cellXml, sharedStrings)
    return { columnIndex, value }
  })

  const maxColumn = Math.max(...positionedCells.map((cell) => cell.columnIndex), positionedCells.length - 1)
  const values = Array.from({ length: maxColumn + 1 }, () => '')
  let sequentialIndex = 0
  for (const cell of positionedCells) {
    const index = cell.columnIndex >= 0 ? cell.columnIndex : sequentialIndex
    if (index >= values.length) {
      values.length = index + 1
      values.fill('', sequentialIndex, values.length)
    }
    values[index] = cell.value
    sequentialIndex = index + 1
  }
  return values
}

function normalizeWorksheetCellValue(type: string | undefined, cellXml: string, sharedStrings: string[]): string {
  if (type === 'inlineStr') {
    return extractSpreadsheetInlineText(cellXml).trim()
  }
  const value = decodeXmlEntities(extractFirstTagText(cellXml, 'v')).trim()
  if (type === 's') {
    const sharedString = sharedStrings[Number(value)]
    return sharedString ?? value
  }
  if (type === 'b') {
    return value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : value
  }
  if (type === 'str') {
    return value
  }
  if (value) {
    return value
  }
  return extractSpreadsheetInlineText(cellXml).trim()
}

function extractSpreadsheetInlineText(xml: string): string {
  return normalizeParagraphText(extractTaggedText(xml, ['t']).join(''))
}

async function readWithSystemTextExtractors(absolutePath: string): Promise<string | null> {
  const extractors: Array<() => Promise<string | null>> = []

  if (process.platform === 'darwin') {
    extractors.push(async () => {
      const { stdout } = await runExecFile('mdls', ['-raw', '-name', 'kMDItemTextContent', absolutePath])
      const value = normalizeWhitespaceBlock(stripOuterQuotes(String(stdout ?? '').trim()))
      if (!value || value === '(null)' || value.toLowerCase() === 'null') {
        return null
      }
      return value
    })
    extractors.push(async () => {
      const { stdout } = await runExecFile('textutil', ['-convert', 'txt', '-stdout', absolutePath])
      const value = normalizeWhitespaceBlock(String(stdout ?? '').trim())
      return value || null
    })
  }

  extractors.push(async () => {
    const { stdout } = await runExecFile('pdftotext', ['-enc', 'UTF-8', '-nopgbrk', absolutePath, '-'])
    const value = normalizeWhitespaceBlock(String(stdout ?? '').trim())
    return value || null
  })

  for (const extractor of extractors) {
    try {
      const value = await extractor()
      if (value) {
        return value
      }
    } catch {
      continue
    }
  }
  return null
}

async function runExecFile(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    execFileCallback(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      resolve({
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      })
    })
  })
}

function extensionOf(targetPath: string): string {
  return path.extname(targetPath).replace('.', '').toLowerCase()
}

function looksLikeText(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return true
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 512))
  let controlCharacters = 0
  for (const byte of sample) {
    if (byte === 0) {
      return false
    }
    if (byte < 7 || (byte > 13 && byte < 32)) {
      controlCharacters += 1
    }
  }
  return controlCharacters / sample.length < 0.05
}

function withHeader(absolutePath: string, body: string): string {
  return `File: ${absolutePath}\n\n${body.trimEnd()}`
}

function normalizeWhitespaceBlock(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeParagraphText(text: string): string {
  return normalizeWhitespaceBlock(text.replace(/[ \t]+\n/g, '\n').replace(/\u00a0/g, ' '))
}

function extractTaggedText(xml: string, tagNames: string[]): string[] {
  const names = tagNames.map((tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const regex = new RegExp(`<(?:${names})\\b[^>]*>([\\s\\S]*?)<\\/(?:${names})>`, 'g')
  return [...xml.matchAll(regex)].map((match) => decodeXmlEntities(stripXmlTags(match[1])))
}

function extractFirstTagText(xml: string, tagName: string): string {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = xml.match(new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`))
  return match ? stripXmlTags(match[1]) : ''
}

function extractAttribute(attributes: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = attributes.match(new RegExp(`${escapedName}="([^"]*)"`))
  return match?.[1]
}

function stripXmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, '')
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function compareNaturalPath(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function columnIndexFromCellRef(cellRef: string): number {
  const letters = cellRef.match(/[A-Z]+/i)?.[0]?.toUpperCase() || ''
  let result = 0
  for (const char of letters) {
    result = result * 26 + (char.charCodeAt(0) - 64)
  }
  return Math.max(0, result - 1)
}

function normalizeZipPath(value: string): string {
  return value.replace(/\\/g, '/')
}

function stripOuterQuotes(value: string): string {
  return value.replace(/^"(.*)"$/, '$1')
}

function createDependencyLoadError(packageName: string, error: unknown): Error {
  return new Error(`Failed to load ${packageName}: ${normalizeErrorMessage(error)}`)
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function describeExpectedFormat(extension: string): string {
  switch (extension) {
    case 'pdf':
      return 'PDF document'
    case 'doc':
    case 'docx':
      return 'Word document'
    case 'ppt':
    case 'pptx':
      return 'PowerPoint document'
    case 'xls':
    case 'xlsx':
      return 'Excel workbook'
    default:
      return extension ? `${extension.toUpperCase()} file` : 'document'
  }
}

function describeFailureStage(extension: string): string {
  switch (extension) {
    case 'pdf':
      return 'extract PDF text'
    case 'doc':
    case 'docx':
      return 'extract Word content'
    case 'ppt':
    case 'pptx':
      return 'extract PowerPoint content'
    case 'xls':
    case 'xlsx':
      return 'extract Excel content'
    default:
      return 'read file'
  }
}

export async function describeFileReadFailure(
  absolutePath: string,
  error: unknown,
  options: FileReadFailureOptions = {},
): Promise<string> {
  const message = normalizeErrorMessage(error)
  const expectedFormat = options.expectedFormat ? ` Expected format: ${options.expectedFormat}.` : ''
  const stage = options.stage ? ` Failed to ${options.stage}.` : ''
  return `Error reading file ${absolutePath}.${stage}${expectedFormat} ${message}`.trim()
}
