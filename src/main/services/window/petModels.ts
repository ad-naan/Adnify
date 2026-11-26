import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { net } from 'electron'
import { PET_MODEL_ENTRY, type PetCharacter } from '@shared/desktopPet'
import type { PetGalleryModel } from '@shared/petGallery'
import { readPetResponse } from './petSpeech'

export interface InstalledPetModel extends PetCharacter {
  assets: string[]
}

const MAX_ASSET_BYTES = 32 * 1024 * 1024
const MAX_MODEL_BYTES = 128 * 1024 * 1024
const MAX_ASSETS = 256
const MODEL_ID_PATTERN = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/

export function normalizePetAsset(value: string): string {
  const components = value.replace(/\\/g, '/').split('/').filter(part => part !== '.')
  if (!components.length || components.some(part => !part || part === '..' || /[:?%#\x00-\x1f]/.test(part))) {
    throw new Error('Invalid model asset path')
  }
  return components.join('/')
}

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function getModelAssets(model: unknown): string[] {
  if (!model || typeof model !== 'object' || !('FileReferences' in model)) throw new Error('Missing model references')
  const refs = model.FileReferences as Record<string, unknown>
  if (!refs || typeof refs !== 'object' || !Array.isArray(refs.Textures) || !refs.Textures.length) {
    throw new Error('Missing model textures')
  }

  const assets = new Set<string>()
  const addFile = (file: unknown, suffix: string) => {
    if (typeof file !== 'string' || !file.toLowerCase().endsWith(suffix)) throw new Error('Invalid model file')
    assets.add(normalizePetAsset(file))
    if (assets.size > MAX_ASSETS) throw new Error('Too many model files')
  }
  addFile(refs.Moc, '.moc3')
  refs.Textures.forEach(file => addFile(file, '.png'))
  for (const [key, suffix] of Object.entries({
    Physics: '.physics3.json',
    Pose: '.pose3.json',
    DisplayInfo: '.cdi3.json',
    UserData: '.userdata3.json',
  })) {
    if (refs[key]) addFile(refs[key], suffix)
  }
  if (Array.isArray(refs.Expressions)) {
    for (const expression of refs.Expressions) addFile(expression?.File, '.exp3.json')
  }
  if (refs.Motions && typeof refs.Motions === 'object') {
    for (const group of Object.values(refs.Motions)) {
      if (!Array.isArray(group)) throw new Error('Invalid motion group')
      for (const motion of group) {
        addFile(motion?.File, '.motion3.json')
        delete motion.Sound
      }
    }
  }
  return [...assets]
}

export async function installPetModel(root: string, manifest: string): Promise<InstalledPetModel> {
  const sourceRoot = await fs.realpath(path.dirname(manifest))
  const chosenManifest = await fs.realpath(manifest)
  if (!isInside(sourceRoot, chosenManifest) || !manifest.toLowerCase().endsWith('.model3.json')) {
    throw new Error('Choose a model3.json file')
  }
  const stat = await fs.stat(chosenManifest)
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid model manifest size')
  const content = await fs.readFile(chosenManifest, 'utf8')
  const name = path.basename(manifest).slice(0, -'.model3.json'.length).slice(0, 60) || 'Live2D'
  return installModel(root, name, content, async asset => {
    const source = await fs.realpath(path.join(sourceRoot, asset))
    if (!isInside(sourceRoot, source)) throw new Error('Model assets must stay inside the selected folder')
    const info = await fs.stat(source)
    if (!info.isFile() || info.size > MAX_ASSET_BYTES) throw new Error('Invalid model asset size')
    return fs.readFile(source)
  })
}

export async function installGalleryPetModel(root: string, entry: PetGalleryModel): Promise<InstalledPetModel> {
  const base = `https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@5-r.5/Samples/Resources/${entry.id}/`
  const download = async (file: string, maxBytes: number) => {
    const encoded = file.split('/').map(encodeURIComponent).join('/')
    const response = await net.fetch(new URL(encoded, base).href, {
      signal: AbortSignal.timeout(15000), redirect: 'error', credentials: 'omit',
    })
    return readPetResponse(response, maxBytes)
  }
  const manifest = await download(`${entry.id}.model3.json`, 1024 * 1024)
  const model = await installModel(root, entry.name, manifest.toString('utf8'), asset => download(asset, MAX_ASSET_BYTES))
  return { ...model, galleryId: entry.id }
}

async function installModel(
  root: string,
  name: string,
  content: string,
  readAsset: (asset: string) => Promise<Buffer>,
): Promise<InstalledPetModel> {
  const model: unknown = JSON.parse(content.replace(/^\uFEFF/, ''))
  const assets = getModelAssets(model)
  const id = randomUUID()
  const directory = path.join(root, id)
  await fs.mkdir(directory, { recursive: true })
  try {
    let totalBytes = 0
    for (const [index, asset] of assets.entries()) {
      const bytes = await readAsset(asset)
      totalBytes += bytes.length
      if (bytes.length > MAX_ASSET_BYTES || totalBytes > MAX_MODEL_BYTES) {
        throw new Error('Model assets exceed the import size limit')
      }
      await fs.writeFile(path.join(directory, String(index)), bytes)
    }
    await fs.writeFile(path.join(directory, PET_MODEL_ENTRY), JSON.stringify(model))
  } catch (error) {
    await removePetModelFiles(root, id)
    throw error
  }
  return { id, name, assets }
}

export async function readPetModelAsset(root: string, model: InstalledPetModel, asset: string): Promise<ArrayBuffer | undefined> {
  if (!MODEL_ID_PATTERN.test(model.id)) return undefined
  const key = normalizePetAsset(asset)
  const index = model.assets.indexOf(key)
  if (key !== PET_MODEL_ENTRY && index < 0) return undefined
  const file = await fs.readFile(path.join(root, model.id, key === PET_MODEL_ENTRY ? key : String(index)))
  return Uint8Array.from(file).buffer
}

export async function removePetModelFiles(root: string, id: string): Promise<void> {
  if (!MODEL_ID_PATTERN.test(id)) return
  await fs.rm(path.join(root, id), { recursive: true, force: true })
}
