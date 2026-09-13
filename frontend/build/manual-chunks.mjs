const bpmnPackages = new Set([
  '@bpmn-io/properties-panel',
  'bpmnlint',
  'camunda-bpmn-js',
  'camunda-bpmn-moddle',
  'diagram-js',
  'ids',
  'min-dash',
  'min-dom',
  'saxen',
  'tiny-svg',
])

const dmnPackages = new Set([
  'camunda-dmn-js',
  'feelers',
  'table-js',
])

const reactPackages = new Set([
  'react',
  'react-dom',
  'react-router',
  'react-router-dom',
  'scheduler',
])

/**
 * Return the actual package represented by a resolved node_modules module ID.
 *
 * pnpm IDs contain two node_modules segments:
 *   node_modules/.pnpm/<store-entry>/node_modules/<package>/...
 * The last segment is the package imported by the bundle. Reading the first
 * segment classifies the complete dependency graph as the synthetic `.pnpm`
 * package and collapses it into one multi-megabyte chunk.
 */
export function packageNameFromModuleId(moduleId) {
  const normalizedId = moduleId.replaceAll('\\', '/').split(/[?#]/, 1)[0]
  const marker = '/node_modules/'
  const markerIndex = normalizedId.lastIndexOf(marker)
  if (markerIndex < 0) return undefined

  const packagePath = normalizedId.slice(markerIndex + marker.length)
  const parts = packagePath.split('/')
  if (!parts[0]) return undefined
  if (parts[0].startsWith('@')) {
    return parts[1] ? `${parts[0]}/${parts[1]}` : undefined
  }
  return parts[0]
}

export function enterpriseGlueManualChunk(moduleId) {
  const sourcePath = moduleId.replaceAll('\\', '/').split(/[?#]/, 1)[0]
  if (sourcePath.endsWith('.css')) return undefined

  const packageName = packageNameFromModuleId(moduleId)
  if (!packageName) return undefined

  if (
    bpmnPackages.has(packageName) ||
    packageName.startsWith('@bpmn-io/') ||
    packageName.startsWith('bpmn-') ||
    packageName.startsWith('bpmnlint-') ||
    packageName.startsWith('camunda-bpmn-') ||
    packageName.startsWith('diagram-js-') ||
    packageName.startsWith('moddle')
  ) {
    return 'bpmn-vendor'
  }

  if (
    dmnPackages.has(packageName) ||
    packageName.startsWith('dmn-') ||
    packageName.startsWith('lezer-feel')
  ) {
    // The modeler shares diagram-js and moddle infrastructure across BPMN and
    // DMN, so keep the existing combined process-modeling boundary.
    return 'bpmn-vendor'
  }

  if (
    packageName.startsWith('@carbon/') ||
    packageName.startsWith('@floating-ui/') ||
    packageName.startsWith('d3-') ||
    packageName === 'd3' ||
    packageName === 'inferno'
  ) {
    return 'carbon-vendor'
  }

  if (packageName.startsWith('@tanstack/')) return 'tanstack-vendor'
  if (reactPackages.has(packageName)) return 'react-vendor'

  if (packageName === 'lucide-react' || packageName === 'react-icons') {
    return 'icons-vendor'
  }

  const normalizedName = packageName.replace(/^@/, '').replaceAll('/', '-')
  return `vendor-${normalizedName}`
}
