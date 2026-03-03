export function extractBpmnProcessId(xml: string): string | null {
  const src = String(xml || '')
  const match = src.match(/<\s*(?:[a-zA-Z0-9_-]+:)?process\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>/i)
  return match?.[1] ? String(match[1]) : null
}

export function extractDmnDecisionId(xml: string): string | null {
  const src = String(xml || '')
  const match = src.match(/<\s*(?:[a-zA-Z0-9_-]+:)?decision\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>/i)
  return match?.[1] ? String(match[1]) : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, '&quot;')
}

export function updateStarbaseFileNameInXml(
  xml: string,
  fileId: string,
  fileName: string
): { xml: string; updated: boolean } {
  const src = String(xml || '')
  if (!fileId || !src) return { xml: src, updated: false }

  const propertiesRegex = /<\s*(?:[a-zA-Z0-9_-]+:)?properties\b[^>]*>[\s\S]*?<\/\s*(?:[a-zA-Z0-9_-]+:)?properties>/gi
  const fileIdRegex = new RegExp(
    `<\\s*(?:[a-zA-Z0-9_-]+:)?property\\b[^>]*\\bname\\s*=\\s*["']starbase:fileId["'][^>]*\\bvalue\\s*=\\s*["']${escapeRegExp(fileId)}["']`,
    'i'
  )
  const fileNameRegex = /(<\s*(?:[a-zA-Z0-9_-]+:)?property\b[^>]*\bname\s*=\s*["']starbase:fileName["'][^>]*\bvalue\s*=\s*["'])([^"']*)(["'][^>]*>)/i

  let updated = false
  const out = src.replace(propertiesRegex, (block) => {
    if (!fileIdRegex.test(block)) return block
    if (fileNameRegex.test(block)) {
      updated = true
      return block.replace(fileNameRegex, `$1${escapeAttribute(fileName)}$3`)
    }
    return block
  })

  return { xml: out, updated }
}
