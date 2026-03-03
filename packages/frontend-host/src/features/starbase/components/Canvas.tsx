import React from 'react'
import CamundaModeler from 'camunda-bpmn-js/lib/camunda-platform/Modeler'
import camundaModdle from 'camunda-bpmn-moddle/resources/camunda.json'
import lintModule from 'bpmn-js-bpmnlint'
import { camundaConfig, camundaResolver } from '../../../config/bpmn-engine-lint'
import ProblemsPanel from './ProblemsPanel'
import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css'
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-codes.css'
import 'bpmn-js-bpmnlint/dist/assets/css/bpmn-js-bpmnlint.css'
import '../../../styles/lint-overrides.css'
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css'
import 'camunda-bpmn-js/dist/assets/camunda-platform-modeler.css'

type SelectionInfo = { id: string; type: string; name?: string }
export default function Canvas({ xml, onSelectionChange, propertiesParent, onModelerReady, onDirty, implementMode = false }: { xml: string; onSelectionChange?: (sel: SelectionInfo | null) => void; propertiesParent?: HTMLDivElement | null; onModelerReady?: (modeler: any) => void; onDirty?: (label?: string) => void; implementMode?: boolean }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const modelerRef = React.useRef<any | null>(null)
  const ignoreChangesRef = React.useRef(false)
  const calledReadyRef = React.useRef(false)
  const [modelerReady, setModelerReady] = React.useState(false)

  // Create modeler once
  React.useEffect(() => {
    if (!containerRef.current) return
    const modeler = new CamundaModeler({
      container: containerRef.current,
      moddleExtensions: { camunda: camundaModdle as any },
      additionalModules: [
        lintModule
      ],
      linting: {
        active: true,
        bpmnlint: {
          config: camundaConfig,
          resolver: camundaResolver
        }
      },
      disableAdjustOrigin: true // Disable auto-alignment that moves elements unexpectedly
    })
    modelerRef.current = modeler
    // Don't call onModelerReady here - wait until importXML completes so element registry is populated

    let canceled = false
    // Selection listener
    try {
      const eventBus = modeler.get('eventBus')
      eventBus.on('selection.changed', (e: any) => {
        const [el] = (e && e.newSelection) || []
        if (!onSelectionChange) return
        if (!el) return onSelectionChange(null)
        const bo = (el as any).businessObject || {}
        onSelectionChange({ id: (el as any).id, type: (el as any).type, name: (bo as any).name })
        try {
          const contextPad = modeler.get('contextPad')
          contextPad?.open?.(el)
        } catch {}
      })
      // Dirty signals - extract command type for meaningful labels
      const getCommandLabel = (): string | null => {
        try {
          const commandStack = modeler.get('commandStack')
          const stack = commandStack._stack || []
          const idx = commandStack._stackIdx
          
          // Commands that are "secondary" - look for the primary command before them
          const secondaryCommands = new Set([
            'lane.updateRefs',
            'id.updateClaim', 
            'canvas.updateRoot',
            'connection.layout'
          ])
          
          // Commands from properties panel - skip these for history
          const propertyPanelCommands = new Set([
            'properties-panel.update-businessobject',
            'propertiesPanel.camunda.changeTemplate',
            'element.updateModdleProperties',
            'element.updateLabel'
          ])
          
          // Check if updateProperties is a color change (should be tracked)
          const isColorChange = (cmd: any): boolean => {
            const props = cmd.context?.properties
            if (!props) return false
            return 'di' in props || 'color' in props || 'stroke' in props || 'fill' in props
          }
          
          // Map command types to human-readable labels
          const labelMap: Record<string, string> = {
            'shape.create': 'Added element',
            'shape.delete': 'Deleted element',
            'shape.move': 'Moved element',
            'shape.resize': 'Resized element',
            'connection.create': 'Added connection',
            'connection.delete': 'Deleted connection',
            'connection.move': 'Moved connection',
            'connection.layout': 'Adjusted connection',
            'connection.reconnect': 'Reconnected',
            'element.updateLabel': 'Renamed element',
            'element.updateProperties': 'Updated properties',
            'elements.move': 'Moved elements',
            'elements.delete': 'Deleted elements',
            'spaceTool': 'Adjusted spacing',
            'lane.add': 'Added lane',
            'lane.divide': 'Divided lane',
            'lane.resize': 'Resized lane',
            'lane.updateRefs': 'Updated lane',
            'id.updateClaim': 'Updated ID',
            'propertiesPanel.camunda.changeTemplate': 'Changed template',
            'properties-panel.update-businessobject': 'Updated properties',
            'canvas.updateRoot': 'Updated canvas',
            'element.autoPlace': 'Added element',
            'elements.create': 'Added elements',
            'shape.append': 'Added element',
            'shape.replace': 'Replaced element',
            'element.copy': 'Copied element',
            'elements.paste': 'Pasted elements',
            'element.setColor': 'Changed color',
            'elements.setColor': 'Changed color',
            'setColor': 'Changed color',
          }
          
          const getLabel = (cmdType: string): string => {
            if (labelMap[cmdType]) return labelMap[cmdType]
            for (const [key, label] of Object.entries(labelMap)) {
              if (cmdType.includes(key)) return label
            }
            return cmdType.replace(/\./g, ' ').replace(/([A-Z])/g, ' $1').trim()
          }
          
          // Convert BPMN type to human-readable name
          const humanizeType = (type: string): string => {
            const cleaned = type.replace('bpmn:', '')
            // Add space before capital letters and trim
            return cleaned
              .replace(/([A-Z])/g, ' $1')
              .replace(/^./, s => s.toUpperCase())
              .trim()
          }
          
          // Extract element name from command context
          const getElementName = (cmd: any): string | null => {
            try {
              // Try different paths where element info might be stored
              const shape = cmd.context?.shape || cmd.context?.element || cmd.context?.newShape
              const connection = cmd.context?.connection
              const element = shape || connection
              
              if (element) {
                const bo = element.businessObject
                if (bo?.name && bo.name.trim()) return bo.name.trim()
                // Fallback to element type (e.g., "Task", "Gateway")
                const type = bo?.$type || element.type || ''
                if (type) return humanizeType(type)
              }
              
              // For commands with multiple elements (move, delete, color change)
              const elements = cmd.context?.elements || cmd.context?.shapes
              if (elements && elements.length > 0) {
                if (elements.length === 1) {
                  const el = elements[0]
                  const bo = el.businessObject
                  if (bo?.name && bo.name.trim()) return bo.name.trim()
                  const type = bo?.$type || el.type || ''
                  if (type) return humanizeType(type)
                } else {
                  return `${elements.length} elements`
                }
              }
              
              // For replace commands (change element type)
              const newShape = cmd.context?.newShape
              if (newShape) {
                const bo = newShape.businessObject
                if (bo?.name && bo.name.trim()) return bo.name.trim()
                const type = bo?.$type || newShape.type || ''
                if (type) return humanizeType(type)
              }
            } catch {}
            return null
          }
          
          if (idx >= 0 && stack[idx]) {
            let cmd = stack[idx]
            let cmdType = cmd.command || cmd.id || 'change'
            
            // Check if command has meaningful context (not empty elements array or just ID change)
            const hasContent = (c: any): boolean => {
              const ctx = c?.context
              if (!ctx) return false
              // Check for empty elements array
              if (ctx.elements && Array.isArray(ctx.elements) && ctx.elements.length === 0) return false
              // Skip ID-only property updates
              const cmdType = c.command || c.id
              if (cmdType === 'element.updateProperties') {
                const props = ctx.properties
                const propKeys = props ? Object.keys(props) : []
                if (propKeys.length === 1 && propKeys[0] === 'id') return false
              }
              // Has some shape/element/connection
              if (ctx.shape || ctx.element || ctx.newShape || ctx.connection) return true
              if (ctx.elements && ctx.elements.length > 0) return true
              if (ctx.shapes && ctx.shapes.length > 0) return true
              return true // Default to true if we can't determine
            }
            
            // Commands that are part of a compound operation - look for the real action
            const compoundCommands = new Set([
              'shape.delete',  // Often part of replace
              'shape.create',  // Often part of replace
              'elements.delete', // Often part of replace
            ])
            
            // If this is a secondary command or has no content, look backwards for the primary
            if ((secondaryCommands.has(cmdType) || !hasContent(cmd)) && idx > 0) {
              for (let i = idx - 1; i >= Math.max(0, idx - 10); i--) {
                const prevCmd = stack[i]
                const prevType = prevCmd?.command || prevCmd?.id
                if (prevType && !secondaryCommands.has(prevType) && hasContent(prevCmd)) {
                  cmd = prevCmd
                  cmdType = prevType
                  break
                }
              }
            }
            
            // If we found a compound command (delete/create), check if there's a replace command nearby
            if (compoundCommands.has(cmdType) && idx > 0) {
              for (let i = idx - 1; i >= Math.max(0, idx - 10); i--) {
                const prevCmd = stack[i]
                const prevType = prevCmd?.command || prevCmd?.id
                if (prevType === 'shape.replace') {
                  cmd = prevCmd
                  cmdType = prevType
                  break
                }
              }
            }
            
            // Skip property panel commands for history (return null)
            if (propertyPanelCommands.has(cmdType)) {
              return null
            }
            
            // Handle element.updateProperties - only track if it's a visual change
            if (cmdType === 'element.updateProperties') {
              if (isColorChange(cmd)) {
                const elementName = getElementName(cmd)
                return elementName ? `Changed color: ${elementName}` : 'Changed color'
              }
              // Skip non-color property updates
              return null
            }
            
            const baseLabel = getLabel(cmdType)
            const elementName = getElementName(cmd)
            
            if (elementName) {
              return `${baseLabel}: ${elementName}`
            }
            return baseLabel
          }
        } catch {}
        return 'Change'
      }
      const emitDirty = () => {
        if (ignoreChangesRef.current) return
        const label = getCommandLabel()
        // Skip if label is null (property panel changes)
        if (label === null) {
          // Still trigger autosave but don't add to history
          onDirty && onDirty(undefined)
          return
        }
        onDirty && onDirty(label)
      }
      eventBus.on('commandStack.changed', emitDirty)
      // Skip direct editing (inline text changes) - these are property changes
      // eventBus.on('directEditing.complete', () => {
      //   if (!ignoreChangesRef.current) onDirty && onDirty('Edited text')
      // })
    } catch {}

    return () => {
      canceled = true
      try {
        modeler.destroy()
      } catch {}
      modelerRef.current = null
    }
  }, [])

  // Toggle lint rules based on implementMode (Design vs Implement tabs)
  React.useEffect(() => {
    const modeler = modelerRef.current
    if (!modeler) return
    try {
      const linting = modeler.get('linting')
      if (!linting || typeof linting.setLinterConfig !== 'function') return
      if (implementMode) {
        linting.setLinterConfig({
          config: camundaConfig,
          resolver: camundaResolver
        })
      } else {
        const emptyResolver = {
          resolveRule: () => null,
          resolveConfig: () => null
        }
        linting.setLinterConfig({
          config: { rules: {} },
          resolver: emptyResolver as any
        })
      }
    } catch {}
  }, [implementMode])

  // Import XML on change
  React.useEffect(() => {
    const modeler = modelerRef.current
    if (!modeler || !xml) return
    ignoreChangesRef.current = true
    modeler
      .importXML(xml)
      .then(() => {
        // allow changes after import to emit
        setTimeout(() => { ignoreChangesRef.current = false }, 50)
        // Signal modeler ready AFTER import so element registry is populated
        if (!calledReadyRef.current) {
          calledReadyRef.current = true
          setModelerReady(true)
          onModelerReady && onModelerReady(modeler)
        }
      })
      .catch(() => {})
  }, [xml])

  // Attach/Detach properties panel without recreating modeler
  React.useEffect(() => {
    try {
      const modeler = modelerRef.current
      if (!modeler) return
      const propertiesPanel = modeler.get('propertiesPanel')
      if (propertiesParent) {
        propertiesPanel.attachTo(propertiesParent)

        // Ensure something is selected so panel isn't empty: select root/participant
        const selection = modeler.get('selection')
        const elementRegistry = modeler.get('elementRegistry')
        const canvas = modeler.get('canvas')
        // Close context pad to prevent it rendering above the drawer
        try { modeler.get('contextPad').close(); } catch {}
        const current = selection && selection.get && selection.get()
        if (!current || current.length === 0) {
          setTimeout(() => {
            try {
              const root = canvas.getRootElement()
              let target = root
              const bo = root && root.businessObject
              if (bo && bo.$type === 'bpmn:Collaboration' && Array.isArray(bo.participants) && bo.participants.length) {
                const participant = bo.participants[0]
                const participantShape = elementRegistry.get(participant.id)
                if (participantShape) target = participantShape
              }
              selection.select(target)
            } catch {}
          }, 0)
        }
      } else {
        propertiesPanel.detach()
      }
    } catch {}
  }, [propertiesParent])

  return (
    <div style={{ position: 'relative', height: '100%', background: 'var(--color-bg-primary)', display: 'flex', flexDirection: 'column' }}>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
      {modelerReady && modelerRef.current && (
        <ProblemsPanel
          modeler={modelerRef.current}
          rightOffset={propertiesParent ? 360 : 0}
        />
      )}
    </div>
  )
}
