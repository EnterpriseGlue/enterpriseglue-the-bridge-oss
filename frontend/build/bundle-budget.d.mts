export interface ViteManifestChunk {
  file: string
  isEntry?: boolean
  isDynamicEntry?: boolean
  imports?: string[]
  dynamicImports?: string[]
  css?: string[]
}

export interface PublicBundleBudget {
  maxInitialTransferGzipBytes: number
  maxLargestInitialJavaScriptRawBytes: number
  maxLargestInitialJavaScriptGzipBytes: number
  maxInitialJavaScriptRequests: number
}

export interface PublicBundleMeasurement {
  initialJavaScriptRequests: number
  initialJavaScriptRawBytes: number
  initialCssRawBytes: number
  initialTransferGzipBytes: number
  largestInitialJavaScriptFile: string | null
  largestInitialJavaScriptRawBytes: number
  largestInitialJavaScriptGzipBytes: number
}

export const publicLoginSignupBudget: Readonly<PublicBundleBudget>
export function measurePublicLoginSignupBundle(
  distDirectory: string,
  manifest: Record<string, ViteManifestChunk>,
): Promise<PublicBundleMeasurement>
export function enforcePublicLoginSignupBudget(
  measurement: PublicBundleMeasurement,
  budget?: PublicBundleBudget,
): void
export function checkBuiltPublicLoginSignupBundle(options: {
  distDirectory: string
  manifestRelativePath?: string
  removeManifest?: boolean
}): Promise<PublicBundleMeasurement>
