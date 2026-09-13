import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

export const publicLoginSignupBudget = Object.freeze({
  maxInitialTransferGzipBytes: 1_310_720,
  maxLargestInitialJavaScriptRawBytes: 2_621_440,
  maxLargestInitialJavaScriptGzipBytes: 614_400,
  maxInitialJavaScriptRequests: 35,
})

function collectInitialManifestKeys(manifest, entryKey) {
  const initialKeys = new Set()
  const visit = (key) => {
    if (initialKeys.has(key)) return
    const chunk = manifest[key]
    if (!chunk) throw new Error(`Manifest import ${key} does not exist`)
    initialKeys.add(key)
    for (const importedKey of chunk.imports ?? []) visit(importedKey)
  }
  visit(entryKey)
  return initialKeys
}

export async function measurePublicLoginSignupBundle(distDirectory, manifest) {
  const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry)
  if (entries.length !== 1) {
    throw new Error(`Expected one frontend entry in the Vite manifest, found ${entries.length}`)
  }

  const initialKeys = collectInitialManifestKeys(manifest, entries[0][0])
  const javascriptFiles = new Set()
  const cssFiles = new Set()
  for (const key of initialKeys) {
    const chunk = manifest[key]
    javascriptFiles.add(chunk.file)
    for (const cssFile of chunk.css ?? []) cssFiles.add(cssFile)
  }

  const javascript = []
  const css = []
  for (const [files, rows] of [[javascriptFiles, javascript], [cssFiles, css]]) {
    for (const file of files) {
      const bytes = await readFile(resolve(distDirectory, file))
      rows.push({
        file,
        rawBytes: bytes.byteLength,
        gzipBytes: gzipSync(bytes, { level: 6 }).byteLength,
      })
    }
  }

  javascript.sort((left, right) => right.rawBytes - left.rawBytes)
  css.sort((left, right) => right.rawBytes - left.rawBytes)
  const largestJavaScript = javascript[0]

  return {
    initialJavaScriptRequests: javascript.length,
    initialJavaScriptRawBytes: javascript.reduce((total, file) => total + file.rawBytes, 0),
    initialCssRawBytes: css.reduce((total, file) => total + file.rawBytes, 0),
    initialTransferGzipBytes: [...javascript, ...css].reduce(
      (total, file) => total + file.gzipBytes,
      0,
    ),
    largestInitialJavaScriptFile: largestJavaScript?.file ?? null,
    largestInitialJavaScriptRawBytes: largestJavaScript?.rawBytes ?? 0,
    largestInitialJavaScriptGzipBytes: largestJavaScript?.gzipBytes ?? 0,
  }
}

export function enforcePublicLoginSignupBudget(measurement, budget = publicLoginSignupBudget) {
  const failures = []
  const checks = [
    ['initial compressed JS/CSS', measurement.initialTransferGzipBytes, budget.maxInitialTransferGzipBytes],
    ['largest initial JS chunk (raw)', measurement.largestInitialJavaScriptRawBytes, budget.maxLargestInitialJavaScriptRawBytes],
    ['largest initial JS chunk (gzip)', measurement.largestInitialJavaScriptGzipBytes, budget.maxLargestInitialJavaScriptGzipBytes],
    ['initial JS request count', measurement.initialJavaScriptRequests, budget.maxInitialJavaScriptRequests],
  ]
  for (const [label, actual, maximum] of checks) {
    if (actual > maximum) failures.push(`${label}: ${actual} exceeds ${maximum}`)
  }
  if (failures.length > 0) {
    throw new Error(`Public login/signup bundle budget failed:\n- ${failures.join('\n- ')}`)
  }
}

export async function checkBuiltPublicLoginSignupBundle({
  distDirectory,
  manifestRelativePath = 'bundle-budget-manifest.json',
  removeManifest = false,
} = {}) {
  if (!distDirectory) throw new Error('distDirectory is required')
  const manifestPath = resolve(distDirectory, manifestRelativePath)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  try {
    const measurement = await measurePublicLoginSignupBundle(distDirectory, manifest)
    enforcePublicLoginSignupBudget(measurement)
    return measurement
  } finally {
    if (removeManifest) await rm(manifestPath)
  }
}
