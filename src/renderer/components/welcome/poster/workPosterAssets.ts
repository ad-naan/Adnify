import { publicAsset } from '@utils/publicAsset'

export const WORK_POSTER_CANVAS_ID = 'adnify-work-poster'
export const WORK_POSTER_WIDTH = 1080
export const WORK_POSTER_HEIGHT = 1440

export const WORK_POSTER_ASSETS = {
  background: publicAsset('brand/poster/backgrounds/paper.png'),
  otter: publicAsset('brand/poster/otter_mascot.png'),
  workshopPanel: publicAsset('brand/poster/backgrounds/workshop_panel.png'),
  blueLab: publicAsset('brand/poster/backgrounds/blue_lab.png'),
  nightFocus: publicAsset('brand/poster/backgrounds/night_focus.png'),
  paperDesk: publicAsset('brand/poster/backgrounds/paper_desk.png'),
  sunnyWorkshop: publicAsset('brand/poster/backgrounds/sunny_workshop.png'),
  badge: publicAsset('brand/poster/otter_workshop_badge.png'),
  propsSheet: publicAsset('brand/poster/sheets/props_sheet.png'),
  stickerSheet: publicAsset('brand/poster/sheets/sticker_sheet.png'),
  notesSheet: publicAsset('brand/poster/sheets/notes_sheet.png'),
  metricCardsSheet: publicAsset('brand/poster/sheets/metric_cards_sheet.png'),
}

export const WORK_POSTER_SPRITES = {
  laptop: { sheet: 'props', x: 21, y: 66, w: 658, h: 457 },
  mug: { sheet: 'props', x: 1022, y: 103, w: 394, h: 465 },
  planNote: { sheet: 'props', x: 687, y: 164, w: 349, h: 350 },
  flowCard: { sheet: 'props', x: 8, y: 539, w: 523, h: 493 },
  gitCube: { sheet: 'props', x: 570, y: 585, w: 305, h: 412 },
  energyCrystal: { sheet: 'props', x: 972, y: 640, w: 245, h: 356 },
  heartCard: { sheet: 'props', x: 1224, y: 706, w: 270, h: 205 },
  otterSticker: { sheet: 'stickers', x: 36, y: 44, w: 285, h: 363 },
  planet: { sheet: 'stickers', x: 365, y: 47, w: 225, h: 105 },
  workshopStamp: { sheet: 'stickers', x: 950, y: 260, w: 250, h: 130 },
  blueTapeWide: { sheet: 'stickers', x: 952, y: 43, w: 258, h: 58 },
  blueTapeShort: { sheet: 'stickers', x: 1232, y: 42, w: 188, h: 62 },
  blueStar: { sheet: 'stickers', x: 833, y: 49, w: 58, h: 70 },
  yellowStar: { sheet: 'stickers', x: 740, y: 175, w: 75, h: 75 },
  aiIcon: { sheet: 'stickers', x: 1054, y: 446, w: 68, h: 68 },
  codeIcon: { sheet: 'stickers', x: 1130, y: 446, w: 68, h: 68 },
  branchIcon: { sheet: 'stickers', x: 1210, y: 446, w: 68, h: 68 },
  robotIcon: { sheet: 'stickers', x: 1300, y: 446, w: 74, h: 68 },
  rocketBadge: { sheet: 'stickers', x: 38, y: 883, w: 162, h: 128 },
  smallLaptop: { sheet: 'stickers', x: 344, y: 879, w: 160, h: 130 },
  smallGit: { sheet: 'stickers', x: 526, y: 877, w: 154, h: 133 },
  smallCrystal: { sheet: 'stickers', x: 716, y: 879, w: 112, h: 132 },
  smallRobot: { sheet: 'stickers', x: 864, y: 876, w: 117, h: 134 },
  noteWide: { sheet: 'notes', x: 50, y: 52, w: 720, h: 405 },
  noteGrid: { sheet: 'notes', x: 790, y: 38, w: 650, h: 486 },
  notePaper: { sheet: 'notes', x: 54, y: 531, w: 416, h: 486 },
  noteTag: { sheet: 'notes', x: 884, y: 526, w: 502, h: 210 },
  noteTicket: { sheet: 'notes', x: 804, y: 772, w: 596, h: 270 },
  metricFolder: { sheet: 'metrics', x: 108, y: 98, w: 584, h: 286 },
  metricBranch: { sheet: 'metrics', x: 728, y: 90, w: 646, h: 286 },
  metricChat: { sheet: 'metrics', x: 106, y: 397, w: 582, h: 286 },
  metricClock: { sheet: 'metrics', x: 724, y: 397, w: 652, h: 286 },
  metricBot: { sheet: 'metrics', x: 108, y: 706, w: 582, h: 286 },
  metricStar: { sheet: 'metrics', x: 724, y: 706, w: 652, h: 286 },
}

export const WORK_POSTER_LAYOUT_BASE = {
  title: { x: 78, y: 82 },
  date: { x: 760, y: 54, w: 246, h: 174 },
  quote: { x: 112, y: 258, w: 408, h: 116 },
  badge: { x: 820, y: 248, w: 96, h: 96 },
  scene: { x: 132, y: 386, w: 816, h: 404 },
  otter: { x: 540, y: 456, w: 280, h: 350 },
  metrics: { x: 104, y: 890, w: 872 },
  footer: { x: 154, y: 1290 },
}
