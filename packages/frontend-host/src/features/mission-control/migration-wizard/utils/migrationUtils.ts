export function typeCategory(t: string) {
  const x = t.toLowerCase()
  if (x.includes('gateway')) return 'gateway'
  if (x.includes('startevent') || x.includes('endevent') || x.includes('intermediate')) return 'event'
  if (x.includes('callevent') || x.includes('callactivity')) return 'callactivity'
  if (x.includes('subprocess')) return 'subprocess'
  if (x.includes('task')) return 'task'
  return x
}

export function toHumanName(s?: string) {
  if (!s) return ''
  const spaced = s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function parseActivities(xml: string | null): Array<{ id: string; name: string; type: string }> {
  const out: Array<{ id: string; name: string; type: string }> = []
  if (!xml) return out
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    const all = Array.from(doc.getElementsByTagName('*')) as any[]
    const allow = new Set([
      'task',
      'userTask',
      'serviceTask',
      'scriptTask',
      'receiveTask',
      'sendTask',
      'manualTask',
      'callActivity',
      'subProcess',
      'intermediateCatchEvent',
      'intermediateThrowEvent',
      'startEvent',
      'endEvent',
      'exclusiveGateway',
      'inclusiveGateway',
      'parallelGateway',
      'eventBasedGateway',
    ])
    for (const n of all) {
      const local = (n.localName || '').toString()
      if (!allow.has(local)) continue
      const id = n.getAttribute('id')
      if (!id) continue
      const name = n.getAttribute('name') || ''
      out.push({ id, name, type: local })
    }
  } catch {}
  return out
}

export function normalizeName(s: string) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim()
}
