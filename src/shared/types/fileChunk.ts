export interface TextFileChunk {
  content: string
  startOffset: number
  nextOffset: number
  totalSize: number
  eof: boolean
}
