export function downloadCanvasPng(canvasId: string, fileBaseName: string) {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null
  if (!canvas) return
  triggerDownload(canvas.toDataURL('image/png'), `${fileBaseName}.png`)
}

function triggerDownload(url: string, filename: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
}
