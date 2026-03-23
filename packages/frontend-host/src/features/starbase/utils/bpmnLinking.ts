export type LinkType = 'process' | 'decision'

export type NameSyncMode = 'manual' | 'auto'

export type ElementLinkInfo = {
  elementId: string
  elementType: 'CallActivity' | 'BusinessRuleTask' | 'EndEvent'
  linkType: LinkType
  targetKey: string | null
  fileId: string | null
  fileName: string | null
  nameSyncMode: NameSyncMode
}

const FILE_ID_PROPERTY = 'starbase:fileId'
const FILE_NAME_PROPERTY = 'starbase:fileName'
const TARGET_PROCESS_ID_PROPERTY = 'starbase:targetProcessId'
const NAME_SYNC_MODE_PROPERTY = 'starbase:nameSyncMode'
const MESSAGE_REF_ID_PROPERTY = 'starbase:messageRefId'

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

function getMessageEventDefinition(bo: any): any | null {
  const defs = bo?.eventDefinitions || bo?.get?.('eventDefinitions') || []
  const first = Array.isArray(defs) ? defs[0] : null
  return String(first?.$type || '') === 'bpmn:MessageEventDefinition' ? first : null
}

function isMessageEndEvent(bo: any, type: string): boolean {
  return type === 'bpmn:EndEvent' && Boolean(getMessageEventDefinition(bo))
}

function getElementName(bo: any): string | null {
  return bo?.name || bo?.get?.('name') || null
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

function getNameSyncMode(bo: any): NameSyncMode {
  return getStarbaseProperty(bo, NAME_SYNC_MODE_PROPERTY) === 'auto' ? 'auto' : 'manual'
}

function getDefinitions(modeler: any, bo: any): any | null {
  const fromModeler = modeler?.getDefinitions?.()
  if (fromModeler) return fromModeler

  let current = bo
  while (current?.$parent) current = current.$parent
  return current?.rootElements ? current : null
}

function getRootElements(definitions: any): any[] {
  const rootElements = definitions?.rootElements || definitions?.get?.('rootElements')
  return Array.isArray(rootElements) ? rootElements : []
}

function getMessageRefId(bo: any): string | null {
  return getStarbaseProperty(bo, MESSAGE_REF_ID_PROPERTY)
}

function findRootMessageById(definitions: any, messageRefId: string): any | null {
  if (!messageRefId) return null
  return (
    getRootElements(definitions).find((root) => String(root?.id || root?.get?.('id') || '') === messageRefId) || null
  )
}

function toMessageRefId(rawId: string): string {
  const normalized = String(rawId || '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)

  if (!normalized) return 'Message_1'
  if (/^[A-Za-z_]/.test(normalized)) return `Message_${normalized}`.slice(0, 64)
  return `Message_${normalized}`.slice(0, 64)
}

function toLinkedElementDisplayName(fileName: string | null | undefined): string {
  const normalized = String(fileName || '').trim()
  if (!normalized) return ''

  const withoutExtension = normalized.replace(/\.(bpmn|dmn)$/i, '')
  return withoutExtension || normalized
}

function ensureMessageRef(modeler: any, moddle: any, element: any, bo: any, fileName: string): { messageRef: any; messageRefId: string } {
  const eventDefinition = getMessageEventDefinition(bo)
  const existingMessageRef = eventDefinition?.messageRef || eventDefinition?.get?.('messageRef') || null
  const messageRefId =
    getMessageRefId(bo) ||
    String(existingMessageRef?.id || existingMessageRef?.get?.('id') || '') ||
    toMessageRefId(element?.id || bo?.id || '1')
  const definitions = getDefinitions(modeler, bo)
  const messageRef =
    findRootMessageById(definitions, messageRefId) ||
    existingMessageRef ||
    moddle.create('bpmn:Message', { id: messageRefId })

  messageRef.id = messageRefId
  messageRef.name = toLinkedElementDisplayName(fileName)

  return { messageRef, messageRefId }
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
      fileId: getStarbaseProperty(bo, FILE_ID_PROPERTY),
      fileName: getStarbaseProperty(bo, FILE_NAME_PROPERTY),
      nameSyncMode: getNameSyncMode(bo),
    }
  }
  if (type === 'bpmn:BusinessRuleTask') {
    return {
      elementId: element.id,
      elementType: 'BusinessRuleTask',
      linkType: 'decision',
      targetKey: getDecisionRef(bo),
      fileId: getStarbaseProperty(bo, FILE_ID_PROPERTY),
      fileName: getStarbaseProperty(bo, FILE_NAME_PROPERTY),
      nameSyncMode: getNameSyncMode(bo),
    }
  }
  if (isMessageEndEvent(bo, type)) {
    return {
      elementId: element.id,
      elementType: 'EndEvent',
      linkType: 'process',
      targetKey: getStarbaseProperty(bo, TARGET_PROCESS_ID_PROPERTY),
      fileId: getStarbaseProperty(bo, FILE_ID_PROPERTY),
      fileName: getStarbaseProperty(bo, FILE_NAME_PROPERTY),
      nameSyncMode: getNameSyncMode(bo),
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
  payload: {
    linkType: LinkType
    targetKey: string
    fileId: string
    fileName: string
    inheritNameIfEmpty?: boolean
    nameSyncMode?: NameSyncMode
    syncName?: boolean
  }
) {
  if (!modeler || !element) return
  const modeling = modeler.get('modeling')
  const moddle = modeler.get('moddle')
  if (!modeling || !moddle) return
  const bo = element.businessObject || element
  const type = bo?.$type || element?.type || ''
  const messageEventDefinition = payload.linkType === 'process' ? getMessageEventDefinition(bo) : null
  const isSemanticMessageLink = payload.linkType === 'process' && isMessageEndEvent(bo, type) && Boolean(messageEventDefinition)

  const { extensionElements, properties, values } = ensureProperties(moddle, bo)
  const nextNameSyncMode = payload.nameSyncMode ?? getNameSyncMode(bo)
  setPropertyValue(moddle, properties, FILE_ID_PROPERTY, payload.fileId)
  setPropertyValue(moddle, properties, FILE_NAME_PROPERTY, payload.fileName)
  setPropertyValue(moddle, properties, NAME_SYNC_MODE_PROPERTY, nextNameSyncMode)
  if (isSemanticMessageLink) {
    setPropertyValue(moddle, properties, TARGET_PROCESS_ID_PROPERTY, payload.targetKey)
    const { messageRef, messageRefId } = ensureMessageRef(modeler, moddle, element, bo, payload.fileName)
    setPropertyValue(moddle, properties, MESSAGE_REF_ID_PROPERTY, messageRefId)
    extensionElements.values = values
    if (typeof modeling.updateModdleProperties === 'function') {
      modeling.updateModdleProperties(element, messageEventDefinition, { messageRef })
    } else {
      messageEventDefinition.messageRef = messageRef
    }
  } else {
    setPropertyValue(moddle, properties, TARGET_PROCESS_ID_PROPERTY, null)
    setPropertyValue(moddle, properties, MESSAGE_REF_ID_PROPERTY, null)
  }
  extensionElements.values = values

  const linkProps: Record<string, any> = { extensionElements }
  const currentName = typeof getElementName(bo) === 'string' ? String(getElementName(bo)).trim() : ''
  const nextName = toLinkedElementDisplayName(payload.fileName)
  if (payload.linkType === 'process') {
    if (!isSemanticMessageLink) {
      linkProps.calledElement = payload.targetKey
    }
  } else {
    linkProps['camunda:decisionRef'] = payload.targetKey
  }
  if (payload.syncName && nextName) {
    linkProps.name = nextName
  } else if (payload.inheritNameIfEmpty && !currentName && nextName) {
    linkProps.name = nextName
  }

  modeling.updateProperties(element, linkProps)
}

export function clearElementLink(modeler: any, element: any, linkType: LinkType) {
  if (!modeler || !element) return
  const modeling = modeler.get('modeling')
  const moddle = modeler.get('moddle')
  if (!modeling || !moddle) return
  const bo = element.businessObject || element
  const type = bo?.$type || element?.type || ''
  const messageEventDefinition = linkType === 'process' ? getMessageEventDefinition(bo) : null
  const currentMessageRef = messageEventDefinition?.messageRef || messageEventDefinition?.get?.('messageRef') || null
  const currentMessageRefId = getMessageRefId(bo) || String(currentMessageRef?.id || currentMessageRef?.get?.('id') || '')
  const definitions = getDefinitions(modeler, bo)
  const rootElements = getRootElements(definitions)

  const { extensionElements, properties, values } = ensureProperties(moddle, bo)
  setPropertyValue(moddle, properties, FILE_ID_PROPERTY, null)
  setPropertyValue(moddle, properties, FILE_NAME_PROPERTY, null)
  setPropertyValue(moddle, properties, TARGET_PROCESS_ID_PROPERTY, null)
  setPropertyValue(moddle, properties, NAME_SYNC_MODE_PROPERTY, null)
  setPropertyValue(moddle, properties, MESSAGE_REF_ID_PROPERTY, null)
  extensionElements.values = values

  const linkProps: Record<string, any> = { extensionElements }
  if (linkType === 'process') {
    if (isMessageEndEvent(bo, type) && messageEventDefinition) {
      if (typeof modeling.updateModdleProperties === 'function') {
        modeling.updateModdleProperties(element, messageEventDefinition, { messageRef: null })
      } else {
        messageEventDefinition.messageRef = null
      }

      if (definitions && currentMessageRefId) {
        const nextRootElements = rootElements.filter(
          (root) => String(root?.id || root?.get?.('id') || '') !== currentMessageRefId
        )
        if (nextRootElements.length !== rootElements.length) {
          if (typeof modeling.updateModdleProperties === 'function') {
            modeling.updateModdleProperties(element, definitions, { rootElements: nextRootElements })
          } else if (Array.isArray(definitions.rootElements)) {
            definitions.rootElements = nextRootElements
          }
        }
      }
    } else {
      linkProps.calledElement = null
    }
  } else {
    linkProps['camunda:decisionRef'] = null
  }

  modeling.updateProperties(element, linkProps)
}
