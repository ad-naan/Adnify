import * as fs from 'fs'
import * as path from 'path'

/** Resolve an npm executable from the package's own metadata. */
export function resolvePackageBin(
  installDir: string,
  packageName: string,
  executable: string,
): string | null {
  const packageJsonPath = path.join(installDir, 'node_modules', packageName, 'package.json')
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      bin?: string | Record<string, string>
    }
    const relativeBin = typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin?.[executable]
    if (!relativeBin) return null

    const resolvedBin = path.resolve(path.dirname(packageJsonPath), relativeBin)
    return fs.existsSync(resolvedBin) ? resolvedBin : null
  } catch {
    return null
  }
}
