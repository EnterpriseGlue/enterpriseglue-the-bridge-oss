const sansFamily = 'IBM Plex Sans'
const bundledFamilies = new Set([sansFamily, 'IBM Plex Sans Arabic', 'IBM Plex Mono'])
const systemFontSessionKey = 'enterpriseglue:system-font-for-visit'

function fontFamily(value: string): string {
  return value.replace(/^["']|["']$/g, '')
}

function normalizedRange(value: string): string {
  return (value || 'U+0-10FFFF').toUpperCase().replace(/\s/g, '').replace(/(U\+|-)0+([0-9A-F])/g, '$1$2')
}

function fontKey(family: string, weight: string, style: string, range: string): string {
  return `${fontFamily(family)}|${weight || 'normal'}|${style || 'normal'}|${normalizedRange(range)}`
}

function removeUnavailableFontRules(sheet: CSSStyleSheet | CSSGroupingRule, retained: Set<string>): void {
  let rules: CSSRuleList
  try {
    rules = sheet.cssRules
  } catch {
    // A separately hosted stylesheet does not own any bundled fonts.
    return
  }
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index]
    if (rule instanceof CSSFontFaceRule) {
      const family = rule.style.getPropertyValue('font-family')
      if (!bundledFamilies.has(fontFamily(family))) continue
      const key = fontKey(family, rule.style.getPropertyValue('font-weight'),
        rule.style.getPropertyValue('font-style'), rule.style.getPropertyValue('unicode-range'))
      if (!retained.has(key)) sheet.deleteRule(index)
    } else if (rule instanceof CSSGroupingRule) {
      removeUnavailableFontRules(rule, retained)
    }
  }
}

export function prepareInitialTypography(): () => void {
  const bundled = Array.from(document.fonts).filter((face) => bundledFamilies.has(fontFamily(face.family)))
  const canUsePlex = (() => {
    try { return sessionStorage.getItem(systemFontSessionKey) === null } catch { return true }
  })()
  const critical = bundled.filter((face) => fontFamily(face.family) === sansFamily && face.style === 'normal' &&
    normalizedRange(face.unicodeRange).split(',').includes('U+20-7E'))
  if (canUsePlex) {
    for (const face of critical) void face.load().catch(() => undefined)
  }

  return () => {
    const ready = canUsePlex && critical.length > 0 && critical.every((face) => face.status === 'loaded')
    const retained = new Set<string>()
    if (ready) {
      for (const face of bundled) {
        if (face.status === 'loaded') retained.add(fontKey(face.family, face.weight, face.style, face.unicodeRange))
      }
    } else {
      try { sessionStorage.setItem(systemFontSessionKey, '1') } catch { /* This document still uses the system font. */ }
    }
    // Freeze the selection before the first render. A font response that
    // arrives afterward cannot become eligible for text in this document.
    for (const sheet of document.styleSheets) removeUnavailableFontRules(sheet, retained)
  }
}
