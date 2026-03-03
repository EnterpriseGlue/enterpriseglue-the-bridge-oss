import React from 'react'
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer'
import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css'
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-codes.css'
import './viewer/modern-bpmn-theme.css'

import { ViewerProps, ElementLinkInfo } from './viewer/viewerTypes'
import { useViewerApi } from './viewer/useViewerApi'
import { useDragToPan } from './viewer/useDragToPan'
import { useXMLImport } from './viewer/useXMLImport'
import { injectHighlightStyles, applyZoomWithPadding } from './viewer/viewerUtils'
import { HIGHLIGHT_STYLES, PADDING_FACTOR, HIGHLIGHT_SELECTED_CLASS } from './viewer/viewerConstants'
import DiagramZoomControls from './DiagramZoomControls'

export default function Viewer({ xml, onReady, initialViewport, onViewportChange, onDiagramReset, onElementClick, onCanvasClick, onElementNavigate, selectedElementId }: ViewerProps) {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const viewerRef = React.useRef<any | null>(null)
  const xmlRef = React.useRef<string>(xml)
  const overlayKeysRef = React.useRef<string[]>([])
  const srcMarksRef = React.useRef<string[]>([])
  const tgtMarksRef = React.useRef<string[]>([])
  const selectedElementRef = React.useRef<string | null>(null)

  // Store callbacks in refs so we always call the latest version
  const onElementClickRef = React.useRef(onElementClick)
  React.useEffect(() => {
    onElementClickRef.current = onElementClick
  }, [onElementClick])

  const onCanvasClickRef = React.useRef(onCanvasClick)
  React.useEffect(() => {
    onCanvasClickRef.current = onCanvasClick
  }, [onCanvasClick])

  const onElementNavigateRef = React.useRef(onElementNavigate)
  React.useEffect(() => {
    onElementNavigateRef.current = onElementNavigate
  }, [onElementNavigate])

  // Initialize BPMN viewer
  React.useEffect(() => {
    if (!containerRef.current) return

    const v = new NavigatedViewer({ container: containerRef.current })
    viewerRef.current = v

    try {
      const canvas: any = v.get('canvas')
      const eventBus: any = v.get('eventBus')
      const elementRegistry: any = v.get('elementRegistry')

      // Inject highlight styles
      if (containerRef.current) {
        injectHighlightStyles(containerRef.current, HIGHLIGHT_STYLES)
      }

      // No automatic re-fit on resize — user controls zoom via the fit-to-screen button

      // Handle element click events
      eventBus && eventBus.on('element.click', (e: any) => {
        const element = e.element
        if (!element || !element.businessObject) return
        
        const bo = element.businessObject
        const type = bo.$type || element.type || ''
        
        // Skip clicks on the root/canvas, pools, and lanes - treat as deselect
        const nonSelectableTypes = ['bpmn:Process', 'bpmn:Collaboration', 'bpmn:Participant', 'bpmn:Lane']
        if (nonSelectableTypes.includes(element.type) || nonSelectableTypes.includes(type) || element.id === '__implicitroot') {
          // Treat as canvas click - deselect
          if (onCanvasClickRef.current) {
            onCanvasClickRef.current()
          }
          return
        }
        
        const name = bo.name || element.id
        const id = element.id

        // Notify parent of click
        if (onElementClickRef.current) {
          onElementClickRef.current(id, name, type.replace('bpmn:', ''))
        }
      })

      // Handle canvas click (click on empty space) to deselect
      eventBus && eventBus.on('canvas.click', () => {
        if (onCanvasClickRef.current) {
          onCanvasClickRef.current()
        }
      })

      // Handle double-click on element icon for navigation
      eventBus && eventBus.on('element.dblclick', (e: any) => {
        const element = e.element
        if (!element || !element.businessObject) return
        
        const bo = element.businessObject
        const type = bo.$type || element.type || ''
        const id = element.id

        // Check if this is a navigable element
        if (onElementNavigateRef.current) {
          let linkInfo: ElementLinkInfo | null = null
          
          // Helper to get extension element values
          const getExtensionValues = () => bo.extensionElements?.values || []
          
          // 1. Call Activity -> navigate to called process
          if (type === 'bpmn:CallActivity') {
            const calledElement = bo.calledElement || bo.get?.('calledElement') || bo.$attrs?.['camunda:calledElement']
            if (calledElement) {
              linkInfo = {
                elementId: id,
                elementType: type.replace('bpmn:', ''),
                linkType: 'process',
                targetKey: calledElement
              }
            }
          }
          
          // 2. Business Rule Task -> navigate to DMN decision
          if (type === 'bpmn:BusinessRuleTask') {
            const decisionRef =
              bo.decisionRef ||
              bo.get?.('decisionRef') ||
              bo.$attrs?.['camunda:decisionRef'] ||
              bo.$attrs?.decisionRef ||
              bo.$attrs?.['decisionRef']
            if (decisionRef) {
              linkInfo = {
                elementId: id,
                elementType: type.replace('bpmn:', ''),
                linkType: 'decision',
                targetKey: decisionRef
              }
            }
          }
          
          // 3. User Task with Form -> navigate to form
          if (type === 'bpmn:UserTask' || type === 'bpmn:StartEvent') {
            const formKey = bo.formKey || bo.get?.('formKey') || bo.$attrs?.['camunda:formKey']
            if (formKey) {
              linkInfo = {
                elementId: id,
                elementType: type.replace('bpmn:', ''),
                linkType: 'form',
                targetKey: formKey,
                metadata: { formType: formKey.startsWith('embedded:') ? 'embedded' : 'external' }
              }
            }
          }
          
          // 4. Service Task with External Topic -> navigate to external tasks
          if (type === 'bpmn:ServiceTask') {
            const taskType = bo.$attrs?.['camunda:type'] || bo.get?.('camunda:type')
            const topic = bo.$attrs?.['camunda:topic'] || bo.get?.('camunda:topic')
            if (taskType === 'external' && topic) {
              linkInfo = {
                elementId: id,
                elementType: type.replace('bpmn:', ''),
                linkType: 'externalTopic',
                targetKey: topic
              }
            }
          }
          
          // 5. Script Task -> show script
          if (type === 'bpmn:ScriptTask') {
            const scriptFormat = bo.scriptFormat || bo.$attrs?.['camunda:scriptFormat'] || 'javascript'
            const script = bo.script || ''
            // Also check for camunda:resource for external scripts
            const resource = bo.$attrs?.['camunda:resource']
            if (script || resource) {
              linkInfo = {
                elementId: id,
                elementType: type.replace('bpmn:', ''),
                linkType: 'script',
                targetKey: resource || script.substring(0, 100), // Truncate long scripts
                metadata: { 
                  scriptFormat,
                  isExternal: resource ? 'true' : 'false',
                  fullScript: script
                }
              }
            }
          }
          
          if (linkInfo) {
            onElementNavigateRef.current(linkInfo)
          }
        }
      })
    } catch {}

    return () => {
      try {
        v.destroy()
      } catch {}
      viewerRef.current = null
    }
  }, [])

  // Create and expose viewer API
  const api = useViewerApi(
    viewerRef,
    xmlRef,
    wrapperRef,
    overlayKeysRef,
    srcMarksRef,
    tgtMarksRef,
    selectedElementRef,
    onViewportChange,
    onDiagramReset
  )

  React.useEffect(() => {
    if (api && onReady) {
      onReady(api)
    }
  }, [api, onReady])

  // Sync selectedElementId prop with diagram selection
  React.useEffect(() => {
    if (api) {
      api.selectElement(selectedElementId || null)
    }
  }, [api, selectedElementId])

  // Handle XML import and initial positioning
  useXMLImport(viewerRef, xmlRef, xml, initialViewport, onDiagramReset)

  // Enable drag-to-pan functionality
  useDragToPan(containerRef, viewerRef, onViewportChange)

  return (
    <div ref={wrapperRef} style={{ height: '100%', width: '100%', position: 'relative', background: 'var(--color-bg-primary)' }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
      <DiagramZoomControls viewerApi={api} position="center-right" />
    </div>
  )
}
