export type ViewerApi = {
  zoomIn: () => void
  zoomOut: () => void
  fitViewport: () => void
  focus: (id: string) => void
  addBadge: (id: string, html: HTMLElement, position?: { top?: number; right?: number; bottom?: number; left?: number }) => void
  clearBadges: () => void
  highlightSrc: (id: string) => void
  highlightTgt: (id: string) => void
  clearHighlights: () => void
  selectElement: (id: string | null) => void
  getSelectedElement: () => string | null
  getAllElements: () => Array<{ id: string; name: string; type: string; x: number }>
  getViewport: () => { x: number; y: number; scale: number } | null
  getContainerRef: () => React.MutableRefObject<HTMLDivElement | null>
  getInternals: () => {
    viewer: any
    canvas: any
    overlays: any
    elementRegistry: any
    eventBus: any
    container: HTMLElement
  }
}

export type ElementLinkInfo = {
  elementId: string
  elementType: string
  linkType: 'process' | 'decision' | 'form' | 'externalTopic' | 'script'
  targetKey: string
  /** Additional metadata for the link (e.g., script format, form type) */
  metadata?: Record<string, string>
}

export type ViewerProps = {
  xml: string
  onReady?: (api: ViewerApi) => void
  initialViewport?: Viewport
  onViewportChange?: (viewport: Viewport) => void
  onDiagramReset?: () => void
  onElementClick?: (elementId: string, elementName: string, elementType: string) => void
  onCanvasClick?: () => void
  onElementNavigate?: (linkInfo: ElementLinkInfo) => void
  selectedElementId?: string | null
}

export type Viewport = {
  x: number
  y: number
  scale: number
}
