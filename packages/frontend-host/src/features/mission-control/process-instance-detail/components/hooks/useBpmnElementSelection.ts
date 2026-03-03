import { useEffect, useRef, useMemo } from 'react'

interface UseBpmnElementSelectionProps {
  bpmnRef: React.MutableRefObject<any>
  clickableActivityIds: Set<string>
  selectedActivityId: string | null
  setSelectedActivityId: (id: string | null) => void
  viewerApi: any
  xmlData: any
  actQData: any[]
  isModMode: boolean
  queuedModActivityId: string | null
  setQueuedModActivityId: (id: string | null) => void
}

/**
 * Hook to manage BPMN element selection and highlighting
 * Handles click events, canvas markers, and activity name lookup
 */
export function useBpmnElementSelection({
  bpmnRef,
  clickableActivityIds,
  selectedActivityId,
  setSelectedActivityId,
  viewerApi,
  xmlData,
  actQData,
  isModMode,
  queuedModActivityId,
  setQueuedModActivityId,
}: UseBpmnElementSelectionProps) {
  
  // Handle queued activity selection in modification mode
  useEffect(() => {
    if (isModMode && queuedModActivityId) {
      setSelectedActivityId(queuedModActivityId)
      setQueuedModActivityId(null)
    }
  }, [isModMode, queuedModActivityId, setSelectedActivityId, setQueuedModActivityId])

  // Set up BPMN element click handlers
  useEffect(() => {
    if (!bpmnRef.current) return
    const eventBus = bpmnRef.current.get('eventBus')
    if (!eventBus) return

    const handler = (e: any) => {
      const el = e?.element
      if (!el || el.waypoints) return
      const id = el.businessObject?.id || el.id
      if (!id) return
      const type = el.businessObject?.$type || el.type || ''
      const allowUnexecutedLinkTargets = type === 'bpmn:CallActivity' || type === 'bpmn:BusinessRuleTask'
      if (clickableActivityIds.size && !clickableActivityIds.has(id) && !allowUnexecutedLinkTargets) {
        setSelectedActivityId(null)
        return
      }
      setSelectedActivityId(id)
    }

    const canvasHandler = () => {
      setSelectedActivityId(null)
    }

    eventBus.on('element.click', handler)
    eventBus.on('canvas.click', canvasHandler)

    return () => {
      eventBus.off('element.click', handler)
      eventBus.off('canvas.click', canvasHandler)
    }
  }, [clickableActivityIds, viewerApi, bpmnRef, setSelectedActivityId])

  // Manage selection highlighting
  const lastSelectionRef = useRef<string | null>(null)
  useEffect(() => {
    if (!bpmnRef.current) return
    const canvas = bpmnRef.current.get('canvas')
    if (!canvas) return

    // Remove previous highlight
    if (lastSelectionRef.current) {
      try { 
        canvas.removeMarker(lastSelectionRef.current, 'highlight-selected') 
      } catch {}
    }

    // Add new highlight
    if (selectedActivityId) {
      try { 
        canvas.addMarker(selectedActivityId, 'highlight-selected') 
      } catch {}
      lastSelectionRef.current = selectedActivityId
    } else {
      lastSelectionRef.current = null
    }
  }, [selectedActivityId, xmlData, bpmnRef])

  // Get selected activity name
  const selectedActivityName = useMemo(() => {
    if (!selectedActivityId) return ''
    const match = actQData.find((a: any) => a.activityId === selectedActivityId)
    return match?.activityName || selectedActivityId
  }, [selectedActivityId, actQData])

  return {
    selectedActivityName,
  }
}
