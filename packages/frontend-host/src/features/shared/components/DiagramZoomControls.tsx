import React from 'react'
import { Button } from '@carbon/react'
import { FitToScreen, Add, Subtract, Maximize, Minimize } from '@carbon/icons-react'

interface DiagramZoomControlsProps {
  viewerApi: any
  position?: 'top-right' | 'center-right'
}

export default function DiagramZoomControls({ viewerApi, position = 'center-right' }: DiagramZoomControlsProps) {
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  
  const positionStyles = position === 'top-right' 
    ? { right: 'var(--spacing-3)', top: 'var(--spacing-3)' }
    : { right: 'var(--spacing-2)', top: '50%', transform: 'translateY(-50%)' }

  // Listen for fullscreen changes
  React.useEffect(() => {
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!document.fullscreenElement
      setIsFullscreen(isNowFullscreen)
      
      // Reset diagram when exiting fullscreen (e.g., via ESC key)
      if (!isNowFullscreen) {
        requestAnimationFrame(() => {
          viewerApi?.fitViewport()
        })
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [viewerApi])

  const toggleFullscreen = () => {
    if (!viewerApi?.getContainerRef) return
    const containerRef = viewerApi.getContainerRef()
    const container = containerRef?.current
    if (!container) return

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => {
        // Reset and center diagram after entering fullscreen
        requestAnimationFrame(() => {
          viewerApi?.fitViewport()
        })
      }).catch((err: unknown) => {
        console.error('Error attempting to enable fullscreen:', err)
      })
    } else {
      document.exitFullscreen().then(() => {
        // Reset and center diagram after exiting fullscreen
        requestAnimationFrame(() => {
          viewerApi?.fitViewport()
        })
      })
    }
  }

  return (
    <div className="diagram-zoom-controls" style={{ 
      position: 'absolute', 
      ...positionStyles,
      display: 'flex', 
      flexDirection: 'column', 
      gap: 'var(--spacing-2)',
      zIndex: 10
    }}>
      <style>{`.diagram-zoom-controls .cds--popover { display: none !important; }`}</style>
      <Button 
        hasIconOnly 
        size="sm" 
        kind="ghost" 
        renderIcon={FitToScreen} 
        iconDescription="Fit to screen" 
        onClick={() => viewerApi?.fitViewport()}
      />
      <Button 
        hasIconOnly 
        size="sm" 
        kind="ghost" 
        renderIcon={Add} 
        iconDescription="Zoom in" 
        onClick={() => viewerApi?.zoomIn()}
      />
      <Button 
        hasIconOnly 
        size="sm" 
        kind="ghost" 
        renderIcon={Subtract} 
        iconDescription="Zoom out" 
        onClick={() => viewerApi?.zoomOut()}
      />
      <Button 
        hasIconOnly 
        size="sm" 
        kind="ghost" 
        renderIcon={isFullscreen ? Minimize : Maximize} 
        iconDescription={isFullscreen ? "Exit fullscreen" : "Fullscreen"} 
        onClick={toggleFullscreen}
      />
    </div>
  )
}
