import { useEffect, useRef, useCallback } from 'react'

interface UseModificationPopoverProps {
  bpmnRef: React.MutableRefObject<any>
  isModMode: boolean
  selectedActivityId: string | null
  moveSourceActivityId: string | null
  activeActivityIds: Set<string>
  addPlanOperation: (kind: 'add' | 'addAfter' | 'cancel') => void
  toggleMoveForSelection: () => void
  onMoveToHere: (targetActivityId: string) => void
}

const POPOVER_OVERLAY_TYPE = 'mod-popover'

function createPopoverElement(
  activityId: string,
  moveSourceActivityId: string | null,
  nodeHasActiveTokens: boolean,
  callbacks: {
    onAddBefore: () => void
    onAddAfter: () => void
    onCancel: () => void
    onMoveFrom: () => void
    onMoveTo: () => void
  }
): HTMLElement {
  const container = document.createElement('div')
  container.style.cssText =
    'display:flex;gap:4px;padding:6px 8px;background:var(--color-bg-primary,#fff);' +
    'border:1px solid var(--color-border-primary,#e0e0e0);border-radius:6px;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.15);white-space:nowrap;position:relative;z-index:100;' +
    'font-family:"IBM Plex Sans",system-ui;font-size:12px;'

  const makeBtn = (label: string, color: string, bgColor: string, onClick: () => void) => {
    const btn = document.createElement('button')
    btn.textContent = label
    btn.style.cssText =
      `background:${bgColor};color:${color};border:none;border-radius:4px;` +
      'padding:4px 8px;cursor:pointer;font-size:11px;font-weight:500;' +
      'font-family:inherit;transition:opacity 0.15s;'
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85' })
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '1' })
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      onClick()
    })
    return btn
  }

  container.appendChild(makeBtn('+ Add token', '#fff', '#0f62fe', callbacks.onAddBefore))

  if (nodeHasActiveTokens) {
    container.appendChild(makeBtn('✕ Cancel', '#fff', '#da1e28', callbacks.onCancel))
  }

  // Move button logic:
  // - If a move source is already selected and this is the source → Cancel move
  // - If a move source is already selected and this is a different node → Move here (complete the move)
  // - If no move source and node has active tokens → Move from here
  // - If no move source and node has NO active tokens → Move to here (auto-pick source)
  const isSource = moveSourceActivityId === activityId
  const hasSource = !!moveSourceActivityId

  if (isSource) {
    container.appendChild(makeBtn('✕ Cancel move', '#fff', '#ff832b', callbacks.onMoveFrom))
  } else if (hasSource) {
    container.appendChild(makeBtn('→ Move here', '#fff', '#ff832b', callbacks.onMoveFrom))
  } else if (nodeHasActiveTokens) {
    container.appendChild(makeBtn('→ Move from', '#fff', '#ff832b', callbacks.onMoveFrom))
  } else {
    container.appendChild(makeBtn('→ Move to here', '#fff', '#ff832b', callbacks.onMoveTo))
  }

  return container
}

export function useModificationPopover({
  bpmnRef,
  isModMode,
  selectedActivityId,
  moveSourceActivityId,
  activeActivityIds,
  addPlanOperation,
  toggleMoveForSelection,
  onMoveToHere,
}: UseModificationPopoverProps) {
  const overlayKeyRef = useRef<string | null>(null)

  const clearPopover = useCallback(() => {
    if (!bpmnRef.current || !overlayKeyRef.current) return
    try {
      const overlays = bpmnRef.current.get('overlays')
      overlays.remove(overlayKeyRef.current)
    } catch {}
    overlayKeyRef.current = null
  }, [bpmnRef])

  const showPopover = useCallback(() => {
    if (!bpmnRef.current || !isModMode || !selectedActivityId) return
    clearPopover()

    const overlays = bpmnRef.current.get('overlays')
    const elementRegistry = bpmnRef.current.get('elementRegistry')
    if (!overlays || !elementRegistry) return

    const el = elementRegistry.get(selectedActivityId)
    if (!el) return

    const nodeHasActiveTokens = activeActivityIds.has(selectedActivityId)

    const popover = createPopoverElement(
      selectedActivityId,
      moveSourceActivityId,
      nodeHasActiveTokens,
      {
        onAddBefore: () => addPlanOperation('add'),
        onAddAfter: () => addPlanOperation('addAfter'),
        onCancel: () => addPlanOperation('cancel'),
        onMoveFrom: () => toggleMoveForSelection(),
        onMoveTo: () => onMoveToHere(selectedActivityId),
      }
    )

    try {
      const key = overlays.add(selectedActivityId, POPOVER_OVERLAY_TYPE, {
        position: { bottom: 4, left: 0 },
        html: popover,
        show: { minZoom: 0, maxZoom: 100 },
      })
      // Force the bpmn-js overlay container to sit above link pill overlays
      queueMicrotask(() => {
        try {
          let el: HTMLElement | null = popover
          while (el && !el.classList?.contains('djs-overlay')) el = el.parentElement
          if (el) el.style.zIndex = '100'
        } catch {}
      })
      overlayKeyRef.current = key
    } catch {}
  }, [bpmnRef, isModMode, selectedActivityId, moveSourceActivityId, activeActivityIds, addPlanOperation, toggleMoveForSelection, onMoveToHere, clearPopover])

  useEffect(() => {
    if (isModMode && selectedActivityId) {
      showPopover()
    } else {
      clearPopover()
    }
  }, [isModMode, selectedActivityId, moveSourceActivityId, showPopover, clearPopover])

  // Clean up on unmount
  useEffect(() => {
    return () => clearPopover()
  }, [clearPopover])
}
