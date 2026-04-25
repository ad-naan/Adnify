const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')
const png2icons = require('png2icons')

const root = path.resolve(__dirname, '..')
const brandRoot = path.join(root, 'public', 'brand')
const iconsRoot = path.join(brandRoot, 'icons')

const variants = [
  {
    id: 'app',
    label: 'Default system icon generated from the light logo',
    source: path.join(brandRoot, 'logos', 'app-light.png'),
    rootOutputs: true,
  },
  {
    id: 'app-dark',
    label: 'Optional dark-logo system icon variant',
    source: path.join(brandRoot, 'logos', 'app.png'),
    rootOutputs: false,
  },
]

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function renderIconPng(source, size) {
  return sharp(source)
    .ensureAlpha()
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()
}

async function writePng(buffer, out) {
  await ensureDir(path.dirname(out))
  await fs.writeFile(out, buffer)
}

async function writePlatformFormats(png512, outDir, basename) {
  await ensureDir(outDir)
  const ico = png2icons.createICO(png512, png2icons.BICUBIC, 0, false)
  const icns = png2icons.createICNS(png512, png2icons.BICUBIC, 0)

  if (!ico) throw new Error(`Failed to create ICO for ${basename}`)
  if (!icns) throw new Error(`Failed to create ICNS for ${basename}`)

  await fs.writeFile(path.join(outDir, `${basename}.ico`), ico)
  await fs.writeFile(path.join(outDir, `${basename}.icns`), icns)
}

async function generateVariant(variant) {
  await fs.access(variant.source)

  const pngs = new Map()
  for (const size of sizes) {
    const png = await renderIconPng(variant.source, size)
    pngs.set(size, png)
    await writePng(png, path.join(iconsRoot, 'sizes', variant.id, `${size}.png`))
  }

  const png1024 = pngs.get(1024)
  const png512 = pngs.get(512)
  const variantDir = variant.rootOutputs ? iconsRoot : path.join(iconsRoot, 'variants', variant.id)

  await writePng(png1024, path.join(variantDir, `${variant.id}.png`))
  await writePlatformFormats(png512, variantDir, variant.id)

  if (variant.rootOutputs) {
    await writePng(png1024, path.join(iconsRoot, 'app.png'))
    await writePlatformFormats(png512, iconsRoot, 'app')
  }

  return {
    id: variant.id,
    label: variant.label,
    source: path.relative(root, variant.source).replaceAll(path.sep, '/'),
    outputs: {
      png: path.relative(root, path.join(variantDir, `${variant.id}.png`)).replaceAll(path.sep, '/'),
      ico: path.relative(root, path.join(variantDir, `${variant.id}.ico`)).replaceAll(path.sep, '/'),
      icns: path.relative(root, path.join(variantDir, `${variant.id}.icns`)).replaceAll(path.sep, '/'),
      sizes: sizes.map((size) => path.relative(root, path.join(iconsRoot, 'sizes', variant.id, `${size}.png`)).replaceAll(path.sep, '/')),
    },
  }
}

async function removeLegacyMixedOutputs() {
  const legacy = [
    path.join(iconsRoot, 'app-light.png'),
    path.join(iconsRoot, 'app-light.ico'),
    path.join(iconsRoot, 'app-light.icns'),
    path.join(iconsRoot, 'sizes', 'app-light'),
    path.join(iconsRoot, 'variants', 'app-light'),
    path.join(brandRoot, 'welcome', 'loader-logo.png'),
  ]

  for (const file of legacy) {
    await fs.rm(file, { force: true })
  }
}

async function main() {
  await ensureDir(iconsRoot)
  const generated = []
  for (const variant of variants) {
    generated.push(await generateVariant(variant))
  }
  await removeLegacyMixedOutputs()

  const manifest = {
    generatedAt: new Date().toISOString(),
    note: 'System icons are generated from public/brand/logos/*.png without applying masks. Keep logos as source/internal assets; keep icons as generated platform assets.',
    defaultSystemIcon: {
      win: 'public/brand/icons/app.ico',
      mac: 'public/brand/icons/app.icns',
      linux: 'public/brand/icons/app.png',
    },
    generated,
  }

  await fs.writeFile(path.join(iconsRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log('Generated platform icons from brand logos.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
