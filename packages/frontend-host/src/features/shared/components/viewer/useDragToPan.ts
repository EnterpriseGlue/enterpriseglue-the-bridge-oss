import React from 'react'

type DragState = {
  active: boolean
  sx: number
  sy: number
  ox: number
  oy: number
}

export function useDragToPan(
  containerRef: React.MutableRefObject<HTMLDivElement | null>,
  viewerRef: React.MutableRefObject<any | null>,
  onViewportChange?: (viewport: { x: number; y: number; scale: number }) => void
) {
  const dragState = React.useRef<DragState | null>(null)

  React.useEffect(() => {
    const el = containerRef.current
    const v = viewerRef.current
    if (!el || !v) return

    const canvas: any = v.get('canvas')

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      try {
        const vb = canvas.viewbox()
        dragState.current = { 
          active: true, 
          sx: e.clientX, 
          sy: e.clientY, 
          ox: vb.x, 
          oy: vb.y 
        }
        ;(el as any).style.cursor = 'grabbing'
        e.preventDefault()
      } catch {}
    }

    const onMove = (e: MouseEvent) => {
      const st = dragState.current
      if (!st || !st.active) return
      try {
        const vb = canvas.viewbox()
        const dx = e.clientX - st.sx
        const dy = e.clientY - st.sy
        const nx = st.ox - dx / vb.scale
        const ny = st.oy - dy / vb.scale
        canvas.viewbox({ x: nx, y: ny, width: vb.width, height: vb.height })
        e.preventDefault()
      } catch {}
    }

    const onUp = () => {
      if (dragState.current) dragState.current.active = false
      ;(el as any).style.cursor = 'grab'
      
      // Notify viewport change after drag ends
      if (onViewportChange) {
        try {
          const vb = canvas.viewbox()
          onViewportChange({ x: vb.x, y: vb.y, scale: vb.scale })
        } catch {}
      }
    }

    // Handle wheel zoom directly since bpmn-js events may not be reaching
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      
      try {
        const vb = canvas.viewbox()
        const delta = e.deltaY > 0 ? 0.95 : 1.05  // Zoom out or in
        const newScale = Math.max(0.2, Math.min(4, vb.scale * delta))
        
        // Zoom towards mouse position
        const rect = el.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top
        
        // Calculate the point in diagram coordinates
        const diagramX = vb.x + mouseX / vb.scale
        const diagramY = vb.y + mouseY / vb.scale
        
        // Calculate new viewbox to keep mouse position fixed
        const newX = diagramX - mouseX / newScale
        const newY = diagramY - mouseY / newScale
        
        canvas.viewbox({
          x: newX,
          y: newY,
          width: vb.width * vb.scale / newScale,
          height: vb.height * vb.scale / newScale
        })
        
        if (onViewportChange) {
          onViewportChange({ x: newX, y: newY, scale: newScale })
        }
      } catch {}
    }

    el.addEventListener('mousedown', onDown)
    el.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    ;(el as any).style.cursor = 'grab'

    return () => {
      el.removeEventListener('mousedown', onDown)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [containerRef.current, viewerRef.current, onViewportChange])
}
