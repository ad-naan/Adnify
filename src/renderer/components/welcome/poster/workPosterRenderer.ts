import { WorkPosterData } from './types'
import {
  WORK_POSTER_ASSETS,
  WORK_POSTER_HEIGHT,
  WORK_POSTER_LAYOUT_BASE,
  WORK_POSTER_SPRITES,
  WORK_POSTER_WIDTH,
} from './workPosterAssets'
import { t, asLanguage } from '@renderer/i18n'

type Rect = { x: number; y: number; w: number; h: number }
type SpriteId = keyof typeof WORK_POSTER_SPRITES
type PosterSheets = Record<string, HTMLImageElement>
type SceneId = 'workshop' | 'blueLab' | 'nightFocus' | 'paperDesk' | 'sunnyWorkshop'

interface SpritePlacement {
  id: SpriteId
  x: number
  y: number
  h: number
  rotate?: number
  alpha?: number
}

interface PosterLayout {
  title: Rect
  date: Rect
  quote: Rect
  badge: Rect
  scene: Rect
  otter: Rect
  metrics: Rect
  footer: { x: number; y: number }
  propVariant: 'desk-left' | 'studio-shelf' | 'balanced-desk' | 'badge-wall'
  sceneId: SceneId
}

const SCENE_ASPECT_RATIOS: Record<SceneId, number> = {
  workshop: 1448 / 1086,
  blueLab: 960 / 640,
  nightFocus: 960 / 640,
  paperDesk: 960 / 640,
  sunnyWorkshop: 960 / 640,
}

const imageCache = new Map<string, Promise<HTMLImageElement>>()

export async function renderWorkPoster(ctx: CanvasRenderingContext2D, poster: WorkPosterData, seed: number) {
  const rng = mulberry32(seed)
  const layout = createRandomLayout(rng)
  const assets = await loadPosterAssets()

  ctx.clearRect(0, 0, WORK_POSTER_WIDTH, WORK_POSTER_HEIGHT)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  ctx.drawImage(assets.background, 0, 0, WORK_POSTER_WIDTH, WORK_POSTER_HEIGHT)
  drawSoftGuide(ctx)
  drawHeader(ctx, poster, layout, assets.sheets.notes)
  drawScene(ctx, assets.scenes[layout.sceneId], layout)
  drawBadge(ctx, assets.badge, layout)
  drawQuote(ctx, poster.quote, layout.quote, assets.sheets.notes)
  drawPosterSprites(ctx, assets.sheets, layout)
  drawOtter(ctx, assets.otter, layout)
  drawMetricsFromSheet(ctx, poster.metrics, layout.metrics, assets.sheets.metrics)
  drawFooter(ctx, poster, layout.footer.x, layout.footer.y)
}

function createRandomLayout(rng: () => number): PosterLayout {
  const base = WORK_POSTER_LAYOUT_BASE
  const sceneW = base.scene.w
  const sceneX = base.scene.x
  const sceneY = base.scene.y
  const otterH = Math.round(rand(rng, 318, 344))
  const otterW = Math.round(otterH * 0.8)
  const otterBias = pick(rng, [-16, 0, 18])
  const propVariant = pick(rng, ['desk-left', 'studio-shelf', 'balanced-desk', 'badge-wall'] as const)
  const sceneId = createSceneId(propVariant)
  const sceneH = Math.round(sceneW / SCENE_ASPECT_RATIOS[sceneId])

  return {
    title: { x: base.title.x, y: base.title.y, w: 548, h: 112 },
    date: {
      x: Math.round(rand(rng, 744, 770)),
      y: Math.round(rand(rng, 52, 66)),
      w: Math.round(rand(rng, 238, 250)),
      h: 168,
    },
    quote: createQuoteLayout(rng),
    badge: createBadgeLayout(propVariant),
    scene: { x: sceneX, y: sceneY, w: sceneW, h: sceneH },
    otter: {
      x: Math.round(sceneX + sceneW * 0.56 + otterBias),
      y: Math.round(sceneY + sceneH - otterH + 18),
      w: otterW,
      h: otterH,
    },
    metrics: {
      x: Math.round(rand(rng, 98, 112)),
      y: Math.round(rand(rng, 958, 978)),
      w: Math.round(rand(rng, 854, 878)),
      h: 268,
    },
    footer: {
      x: Math.round(rand(rng, 154, 166)),
      y: Math.round(rand(rng, 1268, 1284)),
    },
    propVariant,
    sceneId,
  }
}

function createQuoteLayout(rng: () => number): Rect {
  return {
    x: Math.round(rand(rng, 86, 122)),
    y: Math.round(rand(rng, 236, 264)),
    w: 408,
    h: 116,
  }
}

function createSceneId(variant: PosterLayout['propVariant']): SceneId {
  const scenes: Record<PosterLayout['propVariant'], SceneId> = {
    'desk-left': 'paperDesk',
    'studio-shelf': 'sunnyWorkshop',
    'balanced-desk': 'blueLab',
    'badge-wall': 'nightFocus',
  }

  return scenes[variant]
}

function createBadgeLayout(variant: PosterLayout['propVariant']): Rect {
  const badges: Record<PosterLayout['propVariant'], Rect> = {
    'desk-left': { x: 793, y: 239, w: 122, h: 122 },
    'studio-shelf': { x: 800, y: 240, w: 126, h: 126 },
    'balanced-desk': { x: 804, y: 246, w: 118, h: 118 },
    'badge-wall': { x: 792, y: 238, w: 126, h: 126 },
  }

  return badges[variant]
}

async function loadPosterAssets() {
  const [background, workshop, blueLab, nightFocus, paperDesk, sunnyWorkshop, otter, badge, props, stickers, notes, metrics] = await Promise.all([
    loadImage(WORK_POSTER_ASSETS.background),
    loadImage(WORK_POSTER_ASSETS.workshopPanel),
    loadImage(WORK_POSTER_ASSETS.blueLab),
    loadImage(WORK_POSTER_ASSETS.nightFocus),
    loadImage(WORK_POSTER_ASSETS.paperDesk),
    loadImage(WORK_POSTER_ASSETS.sunnyWorkshop),
    loadImage(WORK_POSTER_ASSETS.otter),
    loadImage(WORK_POSTER_ASSETS.badge),
    loadImage(WORK_POSTER_ASSETS.propsSheet),
    loadImage(WORK_POSTER_ASSETS.stickerSheet),
    loadImage(WORK_POSTER_ASSETS.notesSheet),
    loadImage(WORK_POSTER_ASSETS.metricCardsSheet),
  ])
  return {
    background,
    scenes: { workshop, blueLab, nightFocus, paperDesk, sunnyWorkshop },
    otter,
    badge,
    sheets: { props, stickers, notes, metrics },
  }
}

function drawSoftGuide(ctx: CanvasRenderingContext2D) {
  ctx.save()
  ctx.strokeStyle = 'rgba(22, 74, 155, 0.18)'
  ctx.lineWidth = 2
  ctx.setLineDash([12, 10])
  roundedRect(ctx, 30, 30, WORK_POSTER_WIDTH - 60, WORK_POSTER_HEIGHT - 60, 34)
  ctx.stroke()
  ctx.restore()
}

function drawHeader(ctx: CanvasRenderingContext2D, poster: WorkPosterData, layout: PosterLayout, notesSheet: HTMLImageElement) {
  ctx.save()
  ctx.fillStyle = 'rgba(22, 74, 155, 0.72)'
  ctx.font = '700 17px Georgia, "Times New Roman", serif'
  ctx.fillText('BUILD  ·  CODE  ·  CREATE', layout.title.x + 126, layout.title.y - 20)
  ctx.font = poster.language === 'zh'
    ? '800 72px "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", sans-serif'
    : '800 62px Georgia, "Times New Roman", serif'
  ctx.fillStyle = '#164a9b'
  ctx.fillText(poster.title, layout.title.x, layout.title.y + 54)
  ctx.lineCap = 'round'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(22, 74, 155, 0.42)'
  ctx.beginPath()
  ctx.moveTo(layout.title.x + 2, layout.title.y + 80)
  ctx.lineTo(layout.title.x + 438, layout.title.y + 80)
  ctx.stroke()

  ctx.strokeStyle = '#e5b72d'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(layout.title.x + 8, layout.title.y + 88)
  ctx.lineTo(layout.title.x + 172, layout.title.y + 84)
  ctx.stroke()
  ctx.restore()

  const dateCard = {
    x: layout.date.x - 26,
    y: layout.date.y + 12,
    w: layout.date.w + 34,
    h: 142,
  }
  drawSheetSprite(ctx, notesSheet, 'noteGrid', dateCard)
  ctx.fillStyle = '#164a9b'
  ctx.font = '700 22px Georgia, serif'
  ctx.fillText('DATE', dateCard.x + 40, dateCard.y + 40)
  ctx.font = '800 34px Georgia, serif'
  fitText(ctx, poster.date, dateCard.x + 40, dateCard.y + 82, dateCard.w - 90, 34)
  ctx.lineWidth = 2
  ctx.strokeStyle = '#164a9b'
  ctx.beginPath()
  ctx.moveTo(dateCard.x + 40, dateCard.y + 96)
  ctx.lineTo(dateCard.x + dateCard.w - 52, dateCard.y + 96)
  ctx.stroke()
  ctx.font = '800 22px system-ui, sans-serif'
  fitText(ctx, 'Adnify Work Log', dateCard.x + 40, dateCard.y + 122, dateCard.w - 90, 22)
}

function drawScene(ctx: CanvasRenderingContext2D, workshop: HTMLImageElement, layout: PosterLayout) {
  drawRoundedImageContain(ctx, workshop, layout.scene, 28)
}

function drawOtter(ctx: CanvasRenderingContext2D, otter: HTMLImageElement, layout: PosterLayout) {
  ctx.drawImage(otter, layout.otter.x, layout.otter.y, layout.otter.w, layout.otter.h)
}

function drawBadge(ctx: CanvasRenderingContext2D, badge: HTMLImageElement, layout: PosterLayout) {
  const size = Math.round(layout.badge.h * 2.35)
  const x = Math.round(layout.badge.x - size * 0.36)
  const y = Math.round(layout.badge.y - size * 0.12)

  ctx.save()
  ctx.translate(x + size / 2, y + size / 2)
  ctx.rotate(-4 * Math.PI / 180)
  ctx.globalAlpha = 0.26
  ctx.drawImage(badge, -size / 2, -size / 2, size, size)
  ctx.restore()
}

function drawQuote(ctx: CanvasRenderingContext2D, quote: string, q: Rect, notesSheet: HTMLImageElement) {
  if (!quote.trim()) return

  const card = measureQuoteCard(ctx, quote, q)
  drawSheetSprite(ctx, notesSheet, 'noteTicket', card)
  ctx.fillStyle = '#173f86'
  ctx.font = `${card.fontWeight} ${card.fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`
  drawTextBlock(ctx, quote, card.x + 42, card.y + 54, card.w - 104, card.lineHeight, card.maxLines)
}

function measureQuoteCard(ctx: CanvasRenderingContext2D, quote: string, base: Rect) {
  const length = [...quote].length
  const fontSize = length > 48 ? 24 : length > 34 ? 25 : 27
  const lineHeight = fontSize + 9
  const maxLines = length > 48 ? 4 : 3
  const minW = length < 18 ? 430 : 500
  const maxW = 650
  const targetW = Math.round(clamp(length * 10.5 + 260, minW, maxW))
  const usableW = targetW - 104

  ctx.save()
  ctx.font = `800 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`
  const lines = wrapText(ctx, quote, usableW).slice(0, maxLines)
  ctx.restore()

  const targetH = Math.round(clamp(lines.length * lineHeight + 88, 158, maxLines * lineHeight + 96))
  return {
    x: Math.round(clamp(base.x - 8, 66, 706 - targetW)),
    y: Math.round(clamp(base.y - 8, 208, 382 - targetH)),
    w: targetW,
    h: targetH,
    fontSize,
    fontWeight: 800,
    lineHeight,
    maxLines,
  }
}

export function drawMetrics(ctx: CanvasRenderingContext2D, metrics: WorkPosterData['metrics'], area: Rect) {
  const gapX = 24
  const gapY = 22
  const cardW = (area.w - gapX * 2) / 3
  const cardH = 118
  const icons = ['#', '✓', '@', '◷', 'AI', '★']

  metrics.forEach((metric, index) => {
    const col = index % 3
    const row = Math.floor(index / 3)
    const x = area.x + col * (cardW + gapX)
    const y = area.y + row * (cardH + gapY)
    const accent = metric.tone === 'green' ? '#2f7f39' : '#164a9b'
    drawStickerCard(ctx, x, y, cardW, cardH, metric.tone)
    ctx.fillStyle = accent
    ctx.font = '800 23px "Microsoft YaHei", "PingFang SC", sans-serif'
    fitText(ctx, metric.label, x + 84, y + 42, cardW - 108, 23)
    ctx.font = '900 42px Georgia, "Times New Roman", serif'
    fitText(ctx, metric.value, x + 84, y + 92, cardW - 108, 42)
    ctx.font = '800 27px system-ui, sans-serif'
    ctx.fillText(icons[index], x + 30, y + 74)
  })
}

function drawMetricsFromSheet(ctx: CanvasRenderingContext2D, metrics: WorkPosterData['metrics'], area: Rect, metricSheet: HTMLImageElement) {
  const gapX = 24
  const gapY = 22
  const cardW = (area.w - gapX * 2) / 3
  const cardH = 118
  const cards: SpriteId[] = ['metricFolder', 'metricBranch', 'metricChat', 'metricClock', 'metricBot', 'metricStar']

  metrics.forEach((metric, index) => {
    const col = index % 3
    const row = Math.floor(index / 3)
    const x = area.x + col * (cardW + gapX)
    const y = area.y + row * (cardH + gapY)
    const accent = metric.tone === 'green' ? '#2f7f39' : '#164a9b'
    const card = WORK_POSTER_SPRITES[cards[index]]

    ctx.save()
    ctx.shadowColor = 'rgba(30, 45, 70, 0.10)'
    ctx.shadowBlur = 10
    ctx.shadowOffsetY = 5
    ctx.drawImage(metricSheet, card.x, card.y, card.w, card.h, x, y, cardW, cardH)
    ctx.restore()

    ctx.fillStyle = accent
    ctx.font = '800 23px "Microsoft YaHei", "PingFang SC", sans-serif'
    fitText(ctx, metric.label, x + 92, y + 42, cardW - 124, 23)
    ctx.font = '900 42px Georgia, "Times New Roman", serif'
    fitText(ctx, metric.value, x + 92, y + 92, cardW - 124, 42)
  })
}

function drawFooter(ctx: CanvasRenderingContext2D, poster: WorkPosterData, x: number, y: number) {
  ctx.save()
  ctx.fillStyle = '#164a9b'
  ctx.font = '800 30px Georgia, "Microsoft YaHei", serif'
  ctx.fillText('Created with Adnify', x, y + 34)
  ctx.strokeStyle = '#e5b72d'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(x, y + 52)
  ctx.lineTo(x + 340, y + 46)
  ctx.stroke()

  const signX = x + 500
  ctx.fillStyle = '#333'
  ctx.font = '700 22px "Microsoft YaHei", sans-serif'
  ctx.fillText(t('workPosterRenderer.sign', asLanguage(poster.language)), signX, y + 31)
  ctx.strokeStyle = '#222'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(signX + 84, y + 35)
  ctx.lineTo(signX + 338, y + 34)
  ctx.stroke()
  ctx.font = '40px "Segoe Script", "Bradley Hand", cursive'
  fitText(ctx, poster.signature, signX + 108, y + 28, 218, 40)
  ctx.restore()
}

function drawPosterSprites(
  ctx: CanvasRenderingContext2D,
  sheets: PosterSheets,
  layout: PosterLayout,
) {
  ctx.save()

  getSpritePlacements(layout).forEach((placement) => {
    drawSprite(ctx, sheets, placement)
  })

  ctx.restore()
}

function drawSprite(ctx: CanvasRenderingContext2D, sheets: PosterSheets, placement: SpritePlacement) {
  const crop = WORK_POSTER_SPRITES[placement.id]
  const sheet = sheets[crop.sheet]
  if (!sheet) return

  const targetH = placement.h
  const targetW = targetH * crop.w / crop.h
  const px = placement.x
  const py = placement.y

  ctx.save()
  ctx.translate(px + targetW / 2, py + targetH / 2)
  ctx.rotate(((placement.rotate || 0) * Math.PI) / 180)
  ctx.globalAlpha = placement.alpha ?? 1
  ctx.shadowColor = 'rgba(24, 38, 64, 0.20)'
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 6
  ctx.drawImage(sheet, crop.x, crop.y, crop.w, crop.h, -targetW / 2, -targetH / 2, targetW, targetH)
  ctx.restore()
}

function drawSheetSprite(ctx: CanvasRenderingContext2D, sheet: HTMLImageElement, id: SpriteId, rect: Rect, alpha = 1) {
  const crop = WORK_POSTER_SPRITES[id]
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.drawImage(sheet, crop.x, crop.y, crop.w, crop.h, rect.x, rect.y, rect.w, rect.h)
  ctx.restore()
}

function getSpritePlacements(layout: PosterLayout): SpritePlacement[] {
  const variants: Record<PosterLayout['propVariant'], SpritePlacement[]> = {
    'desk-left': [
      { id: 'laptop', x: 292, y: 687, h: 128, rotate: -2 },
      { id: 'planNote', x: 530, y: 779, h: 74, rotate: 4 },
      { id: 'mug', x: 694, y: 476, h: 86, rotate: -5 },
    ],
    'studio-shelf': [
      { id: 'flowCard', x: 390, y: 482, h: 114, rotate: 3, alpha: 0.96 },
      { id: 'mug', x: 684, y: 481, h: 92, rotate: -6 },
      { id: 'planNote', x: 499, y: 751, h: 72, rotate: -3 },
    ],
    'balanced-desk': [
      { id: 'laptop', x: 397, y: 717, h: 118, rotate: 1 },
      { id: 'flowCard', x: 413, y: 477, h: 104, rotate: -4 },
      { id: 'mug', x: 693, y: 541, h: 84, rotate: 5 },
    ],
    'badge-wall': [
      { id: 'flowCard', x: 380, y: 462, h: 122, rotate: -3, alpha: 0.94 },
      { id: 'laptop', x: 360, y: 716, h: 122, rotate: -2 },
      { id: 'planNote', x: 568, y: 734, h: 70, rotate: 5 },
    ],
  }

  return variants[layout.propVariant]
}

function drawStickerCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tone: string) {
  ctx.save()
  ctx.shadowColor = 'rgba(30,45,70,.11)'
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 6
  ctx.fillStyle = '#fff8ec'
  roundedRect(ctx, x, y, w, h, 20)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = 3
  ctx.setLineDash([10, 8])
  ctx.strokeStyle = tone === 'green' ? '#2f7f39' : '#164a9b'
  roundedRect(ctx, x + 12, y + 12, w - 24, h - 24, 14)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

function drawRoundedImageContain(ctx: CanvasRenderingContext2D, image: HTMLImageElement, rect: Rect, radius: number) {
  const scale = Math.min(rect.w / image.width, rect.h / image.height)
  const targetW = image.width * scale
  const targetH = image.height * scale
  const dx = rect.x + (rect.w - targetW) * 0.5
  const dy = rect.y + (rect.h - targetH) * 0.5

  ctx.save()
  ctx.shadowColor = 'rgba(25,40,70,.18)'
  ctx.shadowBlur = 16
  ctx.shadowOffsetY = 8
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, radius)
  ctx.clip()
  ctx.drawImage(image, dx, dy, targetW, targetH)
  ctx.restore()
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function drawTextBlock(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const lines = wrapText(ctx, text, maxWidth)
  lines.slice(0, maxLines).forEach((content, index) => ctx.fillText(content, x, y + index * lineHeight))
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  let line = ''
  for (const char of [...text]) {
    const test = line + char
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = char
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, baseSize: number) {
  let size = baseSize
  while (ctx.measureText(text).width > maxWidth && size > 18) {
    size -= 2
    ctx.font = ctx.font.replace(/\d+px/, `${size}px`)
  }
  ctx.fillText(text, x, y)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src)
  if (cached) return cached

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
  imageCache.set(src, promise)
  return promise
}

function mulberry32(seed: number) {
  return function next() {
    let value = seed += 0x6D2B79F5
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

function rand(rng: () => number, min: number, max: number) {
  return min + (max - min) * rng()
}

function pick<T>(rng: () => number, values: T[]) {
  return values[Math.floor(rng() * values.length)]
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
