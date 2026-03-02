import { Response } from 'express'
import { createHash } from 'node:crypto'

/**
 * Sanitize a string for use in file/resource names
 */
export function sanitize(seg: string): string {
  const s = String(seg || '').trim().replace(/\s+/g, '-').replace(/[\\\u0000-\u001F\u007F]/g, '')
  return s.replace(/[<>:"|?*]/g, '') // basic Windows-illegal chars too
}

/**
 * Hash content using SHA256
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content || '').digest('hex')
}

/**
 * Send upstream response, parsing JSON if possible
 */
export function sendUpstream(res: Response, status: number, text: string) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  try {
    const parsed = JSON.parse(String(text ?? ''))
    return res.status(status).json(parsed)
  } catch {
    return res.status(status).type('text/plain').send(String(text ?? ''))
  }
}

/**
 * Ensure file has correct extension
 */
export function ensureExt(name: string, type: 'bpmn' | 'dmn') {
  const has = name.toLowerCase().endsWith(type === 'bpmn' ? '.bpmn' : '.dmn')
  return has ? name : `${name}.${type}`
}

// =====================
// XML Normalization Functions
// =====================

/**
 * Normalize xmlns URIs in definitions tag (remove whitespace in URIs)
 */
export function normalizeXmlnsUrisInDefinitions(xml: string): string {
  const src = String(xml || '')
  const defsMatch = src.match(/<\s*(?:[a-zA-Z0-9_-]+:)?definitions\b[^>]*>/i)
  if (!defsMatch) return src
  const defsTag = defsMatch[0]
  const fixedDefsTag = defsTag.replace(/\bxmlns(?::[a-zA-Z0-9_-]+)?\s*=\s*(["'])([^"']+)\1/gi, (m: string, _q: string, value: string) => {
    const fixedValue = String(value || '').replace(/\s+/g, '')
    return m.replace(value, fixedValue)
  })
  if (fixedDefsTag === defsTag) return src
  return src.replace(defsTag, fixedDefsTag)
}

/**
 * Normalize BPMN process historyTimeToLive attribute
 */
export function normalizeBpmnProcessHistoryTtl(xml: string): string {
  const src = String(xml || '')
  // Only add/adjust camunda:historyTimeToLive when camunda namespace is declared
  if (!/\bxmlns:camunda\s*=\s*["']/i.test(src)) return src

  return src.replace(/<\s*(?:[a-zA-Z0-9_-]+:)?process\b[^>]*>/gi, (m: string) => {
    const ttlMatch = m.match(/\bcamunda:historyTimeToLive\s*=\s*["']([^"']+)["']/i)
    if (ttlMatch) {
      const v = String(ttlMatch[1] || '').trim()
      if (v === '180') return m.replace(ttlMatch[0], 'camunda:historyTimeToLive="60"')
      return m
    }
    return m.replace(/\s*>$/, ' camunda:historyTimeToLive="60">').replace(/\s*\/>$/, ' camunda:historyTimeToLive="60"/>')
  })
}

/**
 * Normalize DMN decision historyTimeToLive attribute
 */
export function normalizeDmnDecisionHistoryTtl(xml: string): string {
  const src = String(xml || '')
  // Only inject camunda:historyTimeToLive when camunda namespace is declared
  if (!/\bxmlns:camunda\s*=\s*["']/i.test(src)) return src

  return src.replace(/<\s*(?:[a-zA-Z0-9_-]+:)?decision\b[^>]*>/gi, (m: string) => {
    const ttlMatch = m.match(/\bcamunda:historyTimeToLive\s*=\s*["']([^"']+)["']/i)
    if (ttlMatch) {
      const v = String(ttlMatch[1] || '').trim()
      if (v === '30') return m.replace(ttlMatch[0], 'camunda:historyTimeToLive="60"')
      return m
    }
    return m.replace(/\s*>$/, ' camunda:historyTimeToLive="60">').replace(/\s*\/>$/, ' camunda:historyTimeToLive="60"/>')
  })
}

/**
 * Normalize xmlns attribute names in definitions (fix malformed xmlns: attributes)
 */
export function normalizeXmlnsAttributeNamesInDefinitions(xml: string): string {
  const src = String(xml || '')
  const defsMatch = src.match(/<\s*(?:[a-zA-Z0-9_-]+:)?definitions\b[^>]*>/i)
  if (!defsMatch) return src
  const defsTag = defsMatch[0]

  // Repair cases like: "xmlns:\n dmndi" or "xmln\ns:dmndi" which are invalid XML attribute names
  const fixedDefsTag = defsTag
    .replace(/xmln\s+s/gi, 'xmlns')
    .replace(/\bxmlns\s*:\s*/gi, 'xmlns:')

  if (fixedDefsTag === defsTag) return src
  return src.replace(defsTag, fixedDefsTag)
}

/**
 * Normalize DMN diagram/shape IDs (add missing id attributes)
 */
export function normalizeDmnDiIds(xml: string): string {
  let out = String(xml || '')

  let diagramIdx = 1
  out = out.replace(/<\s*(?:[a-zA-Z0-9_-]+:)?DMNDiagram\b[^>]*>/gi, (m: string) => {
    if (/\bid\s*=\s*["']/i.test(m)) return m
    const id = `DMNDiagram_${diagramIdx++}`
    return m.replace(/\s*>$/, ` id="${id}">`).replace(/\s*\/>$/, ` id="${id}"/>`)
  })

  let shapeIdx = 1
  out = out.replace(/<\s*(?:[a-zA-Z0-9_-]+:)?DMNShape\b[^>]*>/gi, (m: string) => {
    if (/\bid\s*=\s*["']/i.test(m)) return m
    const id = `DMNShape_${shapeIdx++}`
    return m.replace(/\s*>$/, ` id="${id}">`).replace(/\s*\/>$/, ` id="${id}"/>`)
  })

  return out
}

/**
 * Sanitize DMN XML (apply all DMN normalizations)
 */
export function sanitizeDmnXml(xml: string): string {
  return normalizeDmnDiIds(normalizeDmnDecisionHistoryTtl(normalizeXmlnsUrisInDefinitions(normalizeXmlnsAttributeNamesInDefinitions(xml))))
}

/**
 * Sanitize BPMN XML (apply all BPMN normalizations)
 */
export function sanitizeBpmnXml(xml: string): string {
  return normalizeBpmnProcessHistoryTtl(String(xml || ''))
}
