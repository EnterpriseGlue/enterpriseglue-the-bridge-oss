export type LinkType = 'process' | 'decision'

export type ElementLinkInfo = {
  elementId: string
  elementType: 'CallActivity' | 'BusinessRuleTask'
  linkType: LinkType
  targetKey: string | null
  fileId: string | null
  fileName: string | null
}

function getDecisionRef(bo: any): string | null {
  return (
    bo?.decisionRef ||
    bo?.get?.('decisionRef') ||
    bo?.$attrs?.['camunda:decisionRef'] ||
    bo?.$attrs?.decisionRef ||
    bo?.$attrs?.['decisionRef'] ||
    null
  )
}

function getCalledElement(bo: any): string | null {
  return (
    bo?.calledElement ||
    bo?.get?.('calledElement') ||
    bo?.$attrs?.['camunda:calledElement'] ||
    null
  )
}

function getStarbaseProperty(bo: any, name: string): string | null {
  const extensionElements = bo?.extensionElements || bo?.get?.('extensionElements')
  const values: any[] = extensionElements?.values || []
  const properties = values.find((val) => String(val?.$type || '').toLowerCase() === 'camunda:properties')
  const props: any[] = properties?.values || []
  const match = props.find((p) => (p?.name || p?.get?.('name')) === name)
  const value = match?.value || match?.get?.('value')
  return value ? String(value) : null
}

export function getElementLinkInfo(element: any): ElementLinkInfo | null {
  if (!element) return null
  const bo = element.businessObject || element
  const type = bo?.$type || element?.type || ''
  if (type === 'bpmn:CallActivity') {
    return {
      elementId: element.id,
      elementType: 'CallActivity',
      linkType: 'process',
      targetKey: getCalledElement(bo),
      fileId: getStarbaseProperty(bo, 'starbase:fileId'),
      fileName: getStarbaseProperty(bo, 'starbase:fileName'),
    }
  }
  if (type === 'bpmn:BusinessRuleTask') {
    return {
      elementId: element.id,
      elementType: 'BusinessRuleTask',
      linkType: 'decision',
      targetKey: getDecisionRef(bo),
      fileId: getStarbaseProperty(bo, 'starbase:fileId'),
      fileName: getStarbaseProperty(bo, 'starbase:fileName'),
    }
  }
  return null
}

function ensureProperties(moddle: any, bo: any) {
  let extensionElements = bo?.extensionElements || bo?.get?.('extensionElements')
  if (!extensionElements) {
    extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] })
    extensionElements.$parent = bo
  }

  const values: any[] = Array.isArray(extensionElements.values) ? [...extensionElements.values] : []
  let properties = values.find((val) => String(val?.$type || '').toLowerCase() === 'camunda:properties')
  if (!properties) {
    properties = moddle.create('camunda:Properties', { values: [] })
    properties.$parent = extensionElements
    values.push(properties)
  }

  return { extensionElements, properties, values }
}

function setPropertyValue(moddle: any, properties: any, name: string, value: string | null) {
  const props: any[] = Array.isArray(properties.values) ? [...properties.values] : []
  const idx = props.findIndex((p) => (p?.name || p?.get?.('name')) === name)

  if (!value) {
    if (idx >= 0) props.splice(idx, 1)
    properties.values = props
    return
  }

  if (idx >= 0) {
    props[idx].value = value
  } else {
    const prop = moddle.create('camunda:Property', { name, value })
    prop.$parent = properties
    props.push(prop)
  }
  properties.values = props
}

export function updateElementLink(
  modeler: any,
  element: any,
  payload: { linkType: LinkType; targetKey: string; fileId: string; fileName: string }
) {
  if (!modeler || !element) return
  const modeling = modeler.get('modeling')
  const moddle = modeler.get('moddle')
  const bo = element.businessObject || element

  const { extensionElements, properties, values } = ensureProperties(moddle, bo)
  setPropertyValue(moddle, properties, 'starbase:fileId', payload.fileId)
  setPropertyValue(moddle, properties, 'starbase:fileName', payload.fileName)
  extensionElements.values = values

  const linkProps: Record<string, any> = { extensionElements }
  if (payload.linkType === 'process') {
    linkProps.calledElement = payload.targetKey
  } else {
    linkProps['camunda:decisionRef'] = payload.targetKey
  }

  modeling.updateProperties(element, linkProps)
}

export function clearElementLink(modeler: any, element: any, linkType: LinkType) {
  if (!modeler || !element) return
  const modeling = modeler.get('modeling')
  const moddle = modeler.get('moddle')
  const bo = element.businessObject || element

  const { extensionElements, properties, values } = ensureProperties(moddle, bo)
  setPropertyValue(moddle, properties, 'starbase:fileId', null)
  setPropertyValue(moddle, properties, 'starbase:fileName', null)
  extensionElements.values = values

  const linkProps: Record<string, any> = { extensionElements }
  if (linkType === 'process') {
    linkProps.calledElement = null
  } else {
    linkProps['camunda:decisionRef'] = null
  }

  modeling.updateProperties(element, linkProps)
}
