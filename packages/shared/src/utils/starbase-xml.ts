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

export type BpmnCallActivityLink = {
  elementId: string
  elementName: string | null
  targetProcessId: string | null
  targetDecisionId?: string | null
  targetFileId: string | null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, '&quot;')
}

function decodeAttribute(value: string): string {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function readAttributeValue(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*["']([^"']+)["']`, 'i'))
  return match?.[1] ? decodeAttribute(String(match[1])) : null
}

function buildPropertyValueRegex(name: string): RegExp {
  return new RegExp(
    `(<\\s*(?:[a-zA-Z0-9_-]+:)?property\\b[^>]*\\bname\\s*=\\s*["']${escapeRegExp(name)}["'][^>]*\\bvalue\\s*=\\s*["'])([^"']*)(["'][^>]*>)`,
    'i'
  )
}

function hasPropertyValue(block: string, name: string, value: string): boolean {
  const propertyRegex = new RegExp(
    `<\\s*(?:[a-zA-Z0-9_-]+:)?property\\b[^>]*\\bname\\s*=\\s*["']${escapeRegExp(name)}["'][^>]*\\bvalue\\s*=\\s*["']${escapeRegExp(value)}["']`,
    'i'
  )
  return propertyRegex.test(block)
}

function readPropertyValue(block: string, name: string): string | null {
  const match = block.match(buildPropertyValueRegex(name))
  return match?.[2] ? String(match[2]) : null
}

export function extractBpmnCallActivityLinks(xml: string): BpmnCallActivityLink[] {
  const src = String(xml || '')
  if (!src) return []

  const links: BpmnCallActivityLink[] = []
  const callActivityRegex = /<\s*(?:[a-zA-Z0-9_-]+:)?callActivity\b[^>]*(?:\/\>|>[\s\S]*?<\/\s*(?:[a-zA-Z0-9_-]+:)?callActivity>)/gi
  const businessRuleTaskRegex = /<\s*(?:[a-zA-Z0-9_-]+:)?businessRuleTask\b[^>]*(?:\/\>|>[\s\S]*?<\/\s*(?:[a-zA-Z0-9_-]+:)?businessRuleTask>)/gi
  const endEventRegex = /<\s*(?:[a-zA-Z0-9_-]+:)?endEvent\b[^>]*(?:\/\>|>[\s\S]*?<\/\s*(?:[a-zA-Z0-9_-]+:)?endEvent>)/gi

  let match: RegExpExecArray | null = null
  while ((match = callActivityRegex.exec(src))) {
    const block = String(match[0] || '')
    const openTagMatch = block.match(/^<\s*(?:[a-zA-Z0-9_-]+:)?callActivity\b[^>]*\/?>/i)
    if (!openTagMatch?.[0]) continue

    const openTag = openTagMatch[0]
    const elementId = readAttributeValue(openTag, 'id')
    if (!elementId) continue

    links.push({
      elementId,
      elementName: readAttributeValue(openTag, 'name'),
      targetProcessId: readAttributeValue(openTag, 'calledElement') || readAttributeValue(openTag, 'camunda:calledElement'),
      targetFileId: readPropertyValue(block, 'starbase:fileId'),
    })
  }

  match = null
  while ((match = businessRuleTaskRegex.exec(src))) {
    const block = String(match[0] || '')
    const openTagMatch = block.match(/^<\s*(?:[a-zA-Z0-9_-]+:)?businessRuleTask\b[^>]*\/?>/i)
    if (!openTagMatch?.[0]) continue

    const openTag = openTagMatch[0]
    const elementId = readAttributeValue(openTag, 'id')
    if (!elementId) continue

    const targetDecisionId = readAttributeValue(openTag, 'camunda:decisionRef') || readAttributeValue(openTag, 'decisionRef')
    const targetFileId = readPropertyValue(block, 'starbase:fileId')
    if (!targetDecisionId && !targetFileId) continue

    links.push({
      elementId,
      elementName: readAttributeValue(openTag, 'name'),
      targetProcessId: null,
      targetDecisionId,
      targetFileId,
    })
  }

  match = null
  while ((match = endEventRegex.exec(src))) {
    const block = String(match[0] || '')
    if (!/<\s*(?:[a-zA-Z0-9_-]+:)?messageEventDefinition\b/i.test(block)) continue

    const openTagMatch = block.match(/^<\s*(?:[a-zA-Z0-9_-]+:)?endEvent\b[^>]*\/?>/i)
    if (!openTagMatch?.[0]) continue

    const openTag = openTagMatch[0]
    const elementId = readAttributeValue(openTag, 'id')
    if (!elementId) continue

    const targetProcessId = readPropertyValue(block, 'starbase:targetProcessId')
    const targetFileId = readPropertyValue(block, 'starbase:fileId')
    if (!targetProcessId && !targetFileId) continue

    links.push({
      elementId,
      elementName: readAttributeValue(openTag, 'name'),
      targetProcessId,
      targetDecisionId: null,
      targetFileId,
    })
  }

  return links
}

function setNameAttribute(tag: string, name: string): string {
  const escaped = escapeAttribute(name)
  if (/(\bname\s*=\s*["'])([^"']*)(["'])/i.test(tag)) {
    return tag.replace(/(\bname\s*=\s*["'])([^"']*)(["'])/i, `$1${escaped}$3`)
  }
  if (/\/?>\s*$/i.test(tag) && /\/\s*>\s*$/i.test(tag)) {
    return tag.replace(/\/\>\s*$/i, ` name="${escaped}" />`)
  }
  return tag.replace(/>\s*$/i, ` name="${escaped}">`)
}

function updateElementNameInBlock(block: string, fileName: string): { block: string; updated: boolean } {
  const openTagMatch = block.match(/^<\s*(?:[a-zA-Z0-9_-]+:)?(?:callActivity|businessRuleTask|endEvent)\b[^>]*>/i)
  if (!openTagMatch) return { block, updated: false }
  const nextOpenTag = setNameAttribute(openTagMatch[0], fileName)
  if (nextOpenTag === openTagMatch[0]) return { block, updated: false }
  return {
    block: `${nextOpenTag}${block.slice(openTagMatch[0].length)}`,
    updated: true,
  }
}

function updateMessageNameInXml(xml: string, messageRefId: string, fileName: string): { xml: string; updated: boolean } {
  if (!messageRefId) return { xml, updated: false }
  const messageRegex = new RegExp(
    `<\\s*(?:[a-zA-Z0-9_-]+:)?message\\b[^>]*\\bid\\s*=\\s*["']${escapeRegExp(messageRefId)}["'][^>]*\\/?>`,
    'i'
  )
  const match = xml.match(messageRegex)
  if (!match?.[0]) return { xml, updated: false }
  const nextTag = setNameAttribute(match[0], fileName)
  if (nextTag === match[0]) return { xml, updated: false }
  return {
    xml: xml.replace(match[0], nextTag),
    updated: true,
  }
}

export function updateStarbaseFileNameInXml(
  xml: string,
  fileId: string,
  fileName: string
): { xml: string; updated: boolean } {
  const src = String(xml || '')
  if (!fileId || !src) return { xml: src, updated: false }

  const elementBlockRegex = /<\s*(?:[a-zA-Z0-9_-]+:)?(?:callActivity|businessRuleTask|endEvent)\b[\s\S]*?<\/\s*(?:[a-zA-Z0-9_-]+:)?(?:callActivity|businessRuleTask|endEvent)>/gi
  const fileNameRegex = buildPropertyValueRegex('starbase:fileName')
  const messageRefIds = new Set<string>()

  let updated = false
  let out = src.replace(elementBlockRegex, (block) => {
    if (!hasPropertyValue(block, 'starbase:fileId', fileId)) return block
    let nextBlock = block
    if (fileNameRegex.test(block)) {
      updated = true
      nextBlock = block.replace(fileNameRegex, `$1${escapeAttribute(fileName)}$3`)
    }
    const messageRefId = readPropertyValue(nextBlock, 'starbase:messageRefId')
    if (messageRefId) messageRefIds.add(messageRefId)
    if (readPropertyValue(nextBlock, 'starbase:nameSyncMode') === 'auto') {
      const renamed = updateElementNameInBlock(nextBlock, fileName)
      if (renamed.updated) {
        updated = true
        nextBlock = renamed.block
      }
    }
    return nextBlock
  })

  for (const messageRefId of messageRefIds) {
    const result = updateMessageNameInXml(out, messageRefId, fileName)
    if (result.updated) {
      updated = true
      out = result.xml
    }
  }

  return { xml: out, updated }
}

export function remapStarbaseFileReferencesInXml(
  xml: string,
  fileIdMap: Map<string, { fileId: string; fileName: string }>
): { xml: string; replacements: number } {
  const src = String(xml || '')
  if (!src || fileIdMap.size === 0) return { xml: src, replacements: 0 }

  const elementBlockRegex = /<\s*(?:[a-zA-Z0-9_-]+:)?(?:callActivity|businessRuleTask|endEvent)\b[\s\S]*?<\/\s*(?:[a-zA-Z0-9_-]+:)?(?:callActivity|businessRuleTask|endEvent)>/gi
  const fileIdRegex = buildPropertyValueRegex('starbase:fileId')
  const fileNameRegex = buildPropertyValueRegex('starbase:fileName')

  let replacements = 0
  const out = src.replace(elementBlockRegex, (block) => {
    const currentFileId = readPropertyValue(block, 'starbase:fileId')
    if (!currentFileId) return block

    const next = fileIdMap.get(currentFileId)
    if (!next) return block

    let nextBlock = block
    if (fileIdRegex.test(nextBlock)) {
      nextBlock = nextBlock.replace(fileIdRegex, `$1${escapeAttribute(next.fileId)}$3`)
    }
    if (fileNameRegex.test(nextBlock)) {
      nextBlock = nextBlock.replace(fileNameRegex, `$1${escapeAttribute(next.fileName)}$3`)
    }

    replacements += 1
    return nextBlock
  })

  return { xml: out, replacements }
}
