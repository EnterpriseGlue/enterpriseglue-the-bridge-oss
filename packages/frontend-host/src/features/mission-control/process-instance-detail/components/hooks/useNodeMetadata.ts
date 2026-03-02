import { useState, useEffect, useCallback } from 'react'

interface NodeMetadata {
  type?: string | null
  decisionRef?: string | null
  decisionRefBinding?: string | null
  decisionRefVersion?: string | null
}

interface IoMappings {
  inputs: any[]
  outputs: any[]
}

interface UseNodeMetadataProps {
  selectedActivityId: string | null
  bpmnRef: React.MutableRefObject<any>
  xmlData: any
  lookupVarType: (name?: string | null) => string | null
}

export function useNodeMetadata({
  selectedActivityId,
  bpmnRef,
  xmlData,
  lookupVarType,
}: UseNodeMetadataProps) {
  const [ioMappings, setIoMappings] = useState<IoMappings>({ inputs: [], outputs: [] })
  const [selectedNodeMeta, setSelectedNodeMeta] = useState<NodeMetadata | null>(null)

  // Format mapping value for display
  const formatMappingValue = useCallback((param: any) => {
    if (!param) return ''
    const t = typeof param.$type === 'string' ? param.$type.toLowerCase() : ''

    if (t && t.endsWith(':in')) {
      const src = (param.sourceExpression || param.source || (param.businessKey ? `businessKey(${param.businessKey})` : '')) as string
      let tgt = ''
      if (param.target) tgt = param.target as string
      else if (param.variables === 'all') tgt = 'all variables'
      else if (param.variables === 'local') tgt = 'local variables'
      if (src && tgt && src !== tgt) return `${src} → ${tgt}`
      return src || tgt || ''
    }

    if (t && t.endsWith(':out')) {
      let src = ''
      if (param.source) src = param.source as string
      else if (param.variables === 'all') src = 'all variables'
      else if (param.variables === 'local') src = 'local variables'
      const tgt = (param.target || '') as string
      if (src && tgt && src !== tgt) return `${src} → ${tgt}`
      return src || tgt || ''
    }

    if (param.value !== undefined && param.value !== null) return String(param.value)
    const def = param.definition
    if (!def) return ''
    if (def.body) return def.body
    if (def.resource) return `resource: ${def.resource}`
    try {
      return JSON.stringify(def)
    } catch {
      return String(def)
    }
  }, [])

  // Format mapping type for display
  const formatMappingType = useCallback((param: any) => {
    if (!param) return ''
    const t = typeof param.$type === 'string' ? param.$type.toLowerCase() : ''

    if (t && t.endsWith(':in')) {
      if (param.sourceExpression) return 'Expression'
      if (param.businessKey) return 'Business key'
      if (param.variables === 'all') return 'All variables'
      if (param.variables === 'local') return 'Local variables'
      if (param.source) return lookupVarType(param.source) || 'Variable'
      return ''
    }

    if (t && t.endsWith(':out')) {
      if (param.sourceExpression) return 'Expression'
      if (param.variables === 'all') return 'All variables'
      if (param.variables === 'local') return 'Local variables'
      if (param.source) return lookupVarType(param.source) || 'Variable'
      if (param.target) return lookupVarType(param.target) || 'Variable'
      return ''
    }

    if (param.definition?.body) return 'Expression'
    if (param.definition?.resource) return 'Resource'
    if (param.value !== undefined && param.value !== null) return 'Value'
    return ''
  }, [lookupVarType])

  // Extract I/O mappings and metadata when selected activity changes
  useEffect(() => {
    if (!selectedActivityId || !bpmnRef.current) {
      setIoMappings((prev) => {
        if (prev.inputs.length === 0 && prev.outputs.length === 0) return prev
        return { inputs: [], outputs: [] }
      })
      setSelectedNodeMeta((prev) => {
        if (prev === null) return prev
        return null
      })
      return
    }

    try {
      const elementRegistry = bpmnRef.current.get('elementRegistry')
      const el = elementRegistry?.get(selectedActivityId)
      const bo = el?.businessObject || null
      const values = bo?.extensionElements?.values || []
      const io = values.find((v: any) => v?.$type?.toLowerCase().includes('inputoutput'))

      const isCallActivity = typeof bo?.$type === 'string' && bo.$type.toLowerCase().includes('callactivity')
      const callIn = isCallActivity
        ? (values.filter((v: any) => {
            const tt = typeof v?.$type === 'string' ? v.$type.toLowerCase() : ''
            return tt.endsWith(':in')
          }) as any[])
        : []
      const callOut = isCallActivity
        ? (values.filter((v: any) => {
            const tt = typeof v?.$type === 'string' ? v.$type.toLowerCase() : ''
            return tt.endsWith(':out')
          }) as any[])
        : []

      const nextIo: IoMappings = {
        inputs: [...(Array.isArray(io?.inputParameters) ? (io.inputParameters as any[]) : []), ...callIn],
        outputs: [...(Array.isArray(io?.outputParameters) ? (io.outputParameters as any[]) : []), ...callOut],
      }

      const nextMeta: NodeMetadata = {
        type: bo?.$type || el?.type || null,
        decisionRef:
          (bo as any)?.decisionRef ||
          bo?.get?.('decisionRef') ||
          bo?.$attrs?.['camunda:decisionRef'] ||
          null,
        decisionRefBinding:
          (bo as any)?.decisionRefBinding ||
          bo?.$attrs?.['camunda:decisionRefBinding'] ||
          null,
        decisionRefVersion:
          (bo as any)?.decisionRefVersion ||
          bo?.$attrs?.['camunda:decisionRefVersion'] ||
          null,
      }

      setIoMappings((prev) => {
        if (prev.inputs.length !== nextIo.inputs.length) return nextIo
        if (prev.outputs.length !== nextIo.outputs.length) return nextIo
        for (let i = 0; i < prev.inputs.length; i++) {
          if (prev.inputs[i] !== nextIo.inputs[i]) return nextIo
        }
        for (let i = 0; i < prev.outputs.length; i++) {
          if (prev.outputs[i] !== nextIo.outputs[i]) return nextIo
        }
        return prev
      })

      setSelectedNodeMeta((prev) => {
        if (!prev) return nextMeta
        if (prev.type !== nextMeta.type) return nextMeta
        if (prev.decisionRef !== nextMeta.decisionRef) return nextMeta
        if (prev.decisionRefBinding !== nextMeta.decisionRefBinding) return nextMeta
        if (prev.decisionRefVersion !== nextMeta.decisionRefVersion) return nextMeta
        return prev
      })
    } catch {
      setIoMappings((prev) => {
        if (prev.inputs.length === 0 && prev.outputs.length === 0) return prev
        return { inputs: [], outputs: [] }
      })
      setSelectedNodeMeta((prev) => {
        if (prev === null) return prev
        return null
      })
    }
  }, [selectedActivityId, !!xmlData])

  return {
    ioMappings,
    selectedNodeMeta,
    formatMappingValue,
    formatMappingType,
  }
}
