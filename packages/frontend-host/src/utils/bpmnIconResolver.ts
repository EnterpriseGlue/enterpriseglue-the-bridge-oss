type GetBpmnElementById = (activityId: string) => any | null | undefined

const stripBpmnPrefix = (val: string) => val.replace(/^bpmn:/, '')

const toEventDefinitionKey = (eventDefinitionTypeRaw?: string) => {
  const t = (eventDefinitionTypeRaw || '').toString()
  if (!t) return null
  return stripBpmnPrefix(t)
}

const resolveEventIconClass = (opts: {
  kind: 'start' | 'intermediate-catch' | 'intermediate-throw' | 'end'
  eventDefinitionKey: string | null
  nonInterrupting: boolean
}) => {
  const { kind, eventDefinitionKey, nonInterrupting } = opts

  if (!eventDefinitionKey) {
    if (kind === 'start') return 'bpmn-icon-start-event-none'
    if (kind === 'end') return 'bpmn-icon-end-event-none'
    return 'bpmn-icon-intermediate-event-none'
  }

  const startBase = nonInterrupting ? 'bpmn-icon-start-event-non-interrupting-' : 'bpmn-icon-start-event-'
  const catchBase = nonInterrupting ? 'bpmn-icon-intermediate-event-catch-non-interrupting-' : 'bpmn-icon-intermediate-event-catch-'
  const throwBase = 'bpmn-icon-intermediate-event-throw-'
  const endBase = 'bpmn-icon-end-event-'

  const mapSuffix = () => {
    switch (eventDefinitionKey) {
      case 'TimerEventDefinition':
        return 'timer'
      case 'MessageEventDefinition':
        return 'message'
      case 'SignalEventDefinition':
        return 'signal'
      case 'ErrorEventDefinition':
        return 'error'
      case 'EscalationEventDefinition':
        return 'escalation'
      case 'ConditionalEventDefinition':
        return 'condition'
      case 'LinkEventDefinition':
        return 'link'
      case 'CancelEventDefinition':
        return 'cancel'
      case 'TerminateEventDefinition':
        return 'terminate'
      case 'CompensateEventDefinition':
        return 'compensation'
      case 'MultipleEventDefinition':
        return 'multiple'
      case 'ParallelMultipleEventDefinition':
        return 'parallel-multiple'
      default:
        return null
    }
  }

  const suffix = mapSuffix()
  if (!suffix) {
    if (kind === 'start') return 'bpmn-icon-start-event-none'
    if (kind === 'end') return 'bpmn-icon-end-event-none'
    return 'bpmn-icon-intermediate-event-none'
  }

  if (kind === 'start') {
    // bpmn-font does not define non-interrupting variants for all start event definitions
    if (nonInterrupting) {
      const supported = new Set(['timer', 'message', 'signal', 'escalation', 'condition', 'multiple', 'parallel-multiple'])
      if (!supported.has(suffix)) return `${startBase.replace('non-interrupting-', '')}${suffix}`
    }
    return `${startBase}${suffix}`
  }

  if (kind === 'intermediate-catch') {
    // non-interrupting variants exist only for some intermediate catch events
    if (nonInterrupting) {
      const supported = new Set(['timer', 'message', 'signal', 'escalation', 'condition', 'multiple', 'parallel-multiple'])
      if (!supported.has(suffix)) return `${catchBase.replace('non-interrupting-', '')}${suffix}`
    }
    return `${catchBase}${suffix}`
  }

  if (kind === 'intermediate-throw') {
    // bpmn-font does not provide a parallel-multiple throw icon
    if (suffix === 'parallel-multiple') return `${throwBase}multiple`
    return `${throwBase}${suffix}`
  }

  // end
  return `${endBase}${suffix}`
}

export const resolveBpmnIconClassFromElement = (el: any): string | null => {
  if (!el) return null

  const bpmnTypeRaw = (el?.businessObject?.$type || el?.type || '') as string
  if (!bpmnTypeRaw) return null

  const bpmnType = stripBpmnPrefix(bpmnTypeRaw)
  const bo = el?.businessObject || el

  switch (bpmnType) {
    // Tasks / Activities
    case 'UserTask':
      return 'bpmn-icon-user-task'
    case 'ServiceTask':
      return 'bpmn-icon-service-task'
    case 'BusinessRuleTask':
      return 'bpmn-icon-business-rule-task'
    case 'ScriptTask':
      return 'bpmn-icon-script-task'
    case 'ManualTask':
      return 'bpmn-icon-manual-task'
    case 'SendTask':
      return 'bpmn-icon-send-task'
    case 'ReceiveTask':
      return 'bpmn-icon-receive-task'
    case 'CallActivity':
      return 'bpmn-icon-call-activity'
    case 'SubProcess':
      return 'bpmn-icon-subprocess-collapsed'
    case 'Transaction':
      return 'bpmn-icon-transaction'

    // Gateways
    case 'ExclusiveGateway':
      return 'bpmn-icon-gateway-xor'
    case 'ParallelGateway':
      return 'bpmn-icon-gateway-parallel'
    case 'InclusiveGateway':
      return 'bpmn-icon-gateway-or'
    case 'EventBasedGateway':
      return 'bpmn-icon-gateway-eventbased'
    case 'ComplexGateway':
      return 'bpmn-icon-gateway-complex'

    // Events
    case 'StartEvent': {
      const defs = (bo?.eventDefinitions || []) as any[]
      const defKey = toEventDefinitionKey(defs[0]?.$type)
      const nonInterrupting = bo?.isInterrupting === false
      return resolveEventIconClass({ kind: 'start', eventDefinitionKey: defKey, nonInterrupting })
    }
    case 'EndEvent': {
      const defs = (bo?.eventDefinitions || []) as any[]
      const defKey = toEventDefinitionKey(defs[0]?.$type)
      return resolveEventIconClass({ kind: 'end', eventDefinitionKey: defKey, nonInterrupting: false })
    }
    case 'IntermediateCatchEvent': {
      const defs = (bo?.eventDefinitions || []) as any[]
      const defKey = toEventDefinitionKey(defs[0]?.$type)
      return resolveEventIconClass({ kind: 'intermediate-catch', eventDefinitionKey: defKey, nonInterrupting: false })
    }
    case 'IntermediateThrowEvent': {
      const defs = (bo?.eventDefinitions || []) as any[]
      const defKey = toEventDefinitionKey(defs[0]?.$type)
      return resolveEventIconClass({ kind: 'intermediate-throw', eventDefinitionKey: defKey, nonInterrupting: false })
    }
    case 'BoundaryEvent': {
      const defs = (bo?.eventDefinitions || []) as any[]
      const defKey = toEventDefinitionKey(defs[0]?.$type)
      const nonInterrupting = bo?.cancelActivity === false
      return resolveEventIconClass({ kind: 'intermediate-catch', eventDefinitionKey: defKey, nonInterrupting })
    }

    default:
      break
  }

  return null
}

export type BpmnIconVisual = {
  iconClass: string
  kind: 'marker' | 'shape'
}

export const resolveBpmnMarkerIconClassFromElement = (el: any): string | null => {
  if (!el) return null

  const bpmnTypeRaw = (el?.businessObject?.$type || el?.type || '') as string
  if (!bpmnTypeRaw) return null

  const bpmnType = stripBpmnPrefix(bpmnTypeRaw)

  // Marker-only icons (Camunda-style: show the top-left marker glyph without the full task box)
  switch (bpmnType) {
    case 'UserTask':
      return 'bpmn-icon-user'
    case 'ServiceTask':
      return 'bpmn-icon-service'
    case 'BusinessRuleTask':
      return 'bpmn-icon-business-rule'
    case 'ScriptTask':
      return 'bpmn-icon-script'
    case 'ManualTask':
      return 'bpmn-icon-manual'
    case 'SendTask':
      return 'bpmn-icon-send'
    case 'ReceiveTask':
      return 'bpmn-icon-receive'
    case 'CallActivity':
      // For call activities, prefer the “+” marker only
      return 'bpmn-icon-sub-process-marker'
    default:
      return null
  }
}

export const resolveBpmnMarkerIconClassFallbackFromActivityType = (activityType?: string) => {
  const t = (activityType || '').toLowerCase()

  if (t.includes('usertask') || t.includes('user task')) return 'bpmn-icon-user'
  if (t.includes('servicetask') || t.includes('service task')) return 'bpmn-icon-service'
  if (t.includes('businessruletask') || t.includes('business rule') || t.includes('dmn')) return 'bpmn-icon-business-rule'
  if (t.includes('scripttask') || t.includes('script task')) return 'bpmn-icon-script'
  if (t.includes('manualtask') || t.includes('manual task')) return 'bpmn-icon-manual'
  if (t.includes('sendtask') || t.includes('send task')) return 'bpmn-icon-send'
  if (t.includes('receivetask') || t.includes('receive task')) return 'bpmn-icon-receive'
  if (t.includes('callactivity') || t.includes('call activity')) return 'bpmn-icon-sub-process-marker'

  return null
}

export const resolveBpmnIconClassFallbackFromActivityType = (activityType?: string) => {
  const t = (activityType || '').toLowerCase()

  if (t.includes('businessruletask') || t.includes('business rule')) return 'bpmn-icon-business-rule-task'
  if (t.includes('usertask') || t.includes('user task')) return 'bpmn-icon-user-task'
  if (t.includes('servicetask') || t.includes('service task')) return 'bpmn-icon-service-task'
  if (t.includes('scripttask') || t.includes('script task')) return 'bpmn-icon-script-task'
  if (t.includes('manualtask') || t.includes('manual task')) return 'bpmn-icon-manual-task'
  if (t.includes('sendtask') || t.includes('send task')) return 'bpmn-icon-send-task'
  if (t.includes('receivetask') || t.includes('receive task')) return 'bpmn-icon-receive-task'
  if (t.includes('callactivity') || t.includes('call activity')) return 'bpmn-icon-call-activity'
  if (t.includes('subprocess') || t.includes('sub process')) return 'bpmn-icon-subprocess-collapsed'

  if (t.includes('exclusivegateway')) return 'bpmn-icon-gateway-xor'
  if (t.includes('parallelgateway')) return 'bpmn-icon-gateway-parallel'
  if (t.includes('inclusivegateway')) return 'bpmn-icon-gateway-or'
  if (t.includes('gateway')) return 'bpmn-icon-gateway-xor'

  if (t.includes('startevent') || t.includes('start event')) return 'bpmn-icon-start-event-none'
  if (t.includes('endevent') || t.includes('end event')) return 'bpmn-icon-end-event-none'
  if (t.includes('event')) return 'bpmn-icon-intermediate-event-none'

  return 'bpmn-icon-task'
}

export const createBpmnIconClassResolver = (getBpmnElementById?: GetBpmnElementById) => {
  const cache = new Map<string, string>()

  return (activityId: string, activityType?: string) => {
    if (!activityId) return resolveBpmnIconClassFallbackFromActivityType(activityType)

    const cached = cache.get(activityId)
    if (cached) return cached

    const el = getBpmnElementById?.(activityId)
    const cls = resolveBpmnIconClassFromElement(el) || resolveBpmnIconClassFallbackFromActivityType(activityType)

    const bpmnTypeRaw = (el?.businessObject?.$type || el?.type || '') as string
    if (bpmnTypeRaw) cache.set(activityId, cls)

    return cls
  }
}

export const createBpmnIconVisualResolver = (getBpmnElementById?: GetBpmnElementById) => {
  const cache = new Map<string, BpmnIconVisual>()

  return (activityId: string, activityType?: string): BpmnIconVisual => {
    if (!activityId) {
      return { iconClass: resolveBpmnIconClassFallbackFromActivityType(activityType), kind: 'shape' }
    }

    const cached = cache.get(activityId)
    if (cached) return cached

    const el = getBpmnElementById?.(activityId)

    const marker = resolveBpmnMarkerIconClassFromElement(el) || resolveBpmnMarkerIconClassFallbackFromActivityType(activityType)
    const shape = resolveBpmnIconClassFromElement(el) || resolveBpmnIconClassFallbackFromActivityType(activityType)

    const resolved: BpmnIconVisual = marker
      ? { iconClass: marker, kind: 'marker' }
      : { iconClass: shape, kind: 'shape' }

    const bpmnTypeRaw = (el?.businessObject?.$type || el?.type || '') as string
    if (bpmnTypeRaw) cache.set(activityId, resolved)

    return resolved
  }
}
