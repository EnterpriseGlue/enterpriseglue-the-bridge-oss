import React from 'react'
import { Button } from '@carbon/react'
import { 
  FitToScreen, 
  CenterCircle, 
  Add, 
  Subtract
} from '@carbon/icons-react'

interface CanvasToolbarProps {
  modeler: any | null
}

export default function CanvasToolbar({ modeler }: CanvasToolbarProps) {
  const getCanvas = React.useCallback(() => {
    if (!modeler) return null
    try {
      return modeler.get('canvas')
    } catch {
      return null
    }
  }, [modeler])

  const handleFitViewport = React.useCallback(() => {
    const canvas = getCanvas()
    if (canvas) {
      canvas.zoom('fit-viewport')
    }
  }, [getCanvas])

  const handleCenter = React.useCallback(() => {
    const canvas = getCanvas()
    if (canvas) {
      // Get the viewbox and center on the diagram content
      const viewbox = canvas.viewbox()
      const inner = viewbox.inner
      canvas.viewbox({
        x: inner.x + inner.width / 2 - viewbox.outer.width / 2,
        y: inner.y + inner.height / 2 - viewbox.outer.height / 2,
        width: viewbox.outer.width,
        height: viewbox.outer.height
      })
    }
  }, [getCanvas])

  const handleZoomIn = React.useCallback(() => {
    const canvas = getCanvas()
    if (canvas) {
      const currentZoom = canvas.zoom()
      const newZoom = typeof currentZoom === 'number' && isFinite(currentZoom) 
        ? currentZoom * 1.2 
        : 1.2
      canvas.zoom(Math.min(4, newZoom))
    }
  }, [getCanvas])

  const handleZoomOut = React.useCallback(() => {
    const canvas = getCanvas()
    if (canvas) {
      const currentZoom = canvas.zoom()
      const newZoom = typeof currentZoom === 'number' && isFinite(currentZoom) 
        ? currentZoom * 0.8 
        : 0.8
      canvas.zoom(Math.max(0.1, newZoom))
    }
  }, [getCanvas])

  if (!modeler) return null

  return (
    <div 
      style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '2px',
        background: 'var(--cds-layer-01, #f4f4f4)',
        borderRadius: '6px',
        padding: '2px 4px',
        border: '1px solid var(--cds-border-subtle-01, #e0e0e0)'
      }}
    >
      <Button
        hasIconOnly
        size="sm"
        kind="ghost"
        renderIcon={FitToScreen}
        iconDescription="Fit to viewport"
        onClick={handleFitViewport}
        style={{ minWidth: '32px', minHeight: '32px' }}
      />
      <Button
        hasIconOnly
        size="sm"
        kind="ghost"
        renderIcon={CenterCircle}
        iconDescription="Center diagram"
        onClick={handleCenter}
        style={{ minWidth: '32px', minHeight: '32px' }}
      />
      <div style={{ width: '1px', height: '20px', background: 'var(--cds-border-subtle-01, #e0e0e0)' }} />
      <Button
        hasIconOnly
        size="sm"
        kind="ghost"
        renderIcon={Subtract}
        iconDescription="Zoom out"
        onClick={handleZoomOut}
        style={{ minWidth: '32px', minHeight: '32px' }}
      />
      <Button
        hasIconOnly
        size="sm"
        kind="ghost"
        renderIcon={Add}
        iconDescription="Zoom in"
        onClick={handleZoomIn}
        style={{ minWidth: '32px', minHeight: '32px' }}
      />
    </div>
  )
}
