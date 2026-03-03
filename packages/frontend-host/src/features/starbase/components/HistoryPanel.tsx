import React from 'react'
import { Button } from '@carbon/react'
import { Undo, Redo, TrashCan } from '@carbon/icons-react'
import type { HistorySnapshot } from '../hooks/useXmlHistory'

interface HistoryPanelProps {
  snapshots: HistorySnapshot[]
  currentIndex: number
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onGoToSnapshot: (index: number) => void
  onClearHistory: () => void
  onClose: () => void
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - timestamp
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatTimeExact(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function parseLabel(label: string): { action: string; elementName: string | null } {
  // Labels are in format "Action: ElementName" or just "Action"
  const colonIndex = label.indexOf(': ')
  if (colonIndex > 0) {
    return {
      action: label.substring(0, colonIndex),
      elementName: label.substring(colonIndex + 2)
    }
  }
  return { action: label, elementName: null }
}

// Parse XML to extract element counts for preview
function getSnapshotStats(xml: string): { tasks: number; gateways: number; events: number; connections: number } {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'text/xml')
    
    const tasks = doc.querySelectorAll('[*|type*="Task"], task, serviceTask, userTask, scriptTask, sendTask, receiveTask, manualTask, businessRuleTask, callActivity, subProcess').length
    const gateways = doc.querySelectorAll('[*|type*="Gateway"], exclusiveGateway, parallelGateway, inclusiveGateway, eventBasedGateway, complexGateway').length
    const events = doc.querySelectorAll('[*|type*="Event"], startEvent, endEvent, intermediateCatchEvent, intermediateThrowEvent, boundaryEvent').length
    const connections = doc.querySelectorAll('sequenceFlow, messageFlow, association').length
    
    return { tasks, gateways, events, connections }
  } catch {
    return { tasks: 0, gateways: 0, events: 0, connections: 0 }
  }
}

// Compare two snapshots and return diff
function getSnapshotDiff(
  currentXml: string | undefined, 
  previousXml: string | undefined
): { added: string[]; removed: string[]; changed: string[] } {
  if (!currentXml || !previousXml) {
    return { added: [], removed: [], changed: [] }
  }
  
  try {
    const parser = new DOMParser()
    const currentDoc = parser.parseFromString(currentXml, 'text/xml')
    const previousDoc = parser.parseFromString(previousXml, 'text/xml')
    
    // Get all elements with IDs
    const getElements = (doc: Document): Map<string, { type: string; name: string }> => {
      const map = new Map<string, { type: string; name: string }>()
      const elements = doc.querySelectorAll('[id]')
      elements.forEach(el => {
        const id = el.getAttribute('id')
        const name = el.getAttribute('name') || ''
        const type = el.tagName.replace('bpmn:', '').replace(/([A-Z])/g, ' $1').trim()
        if (id && !id.includes('_di') && !id.includes('BPMNDiagram') && !id.includes('BPMNPlane')) {
          map.set(id, { type, name })
        }
      })
      return map
    }
    
    const currentElements = getElements(currentDoc)
    const previousElements = getElements(previousDoc)
    
    const added: string[] = []
    const removed: string[] = []
    
    // Find added elements
    currentElements.forEach((value, id) => {
      if (!previousElements.has(id)) {
        added.push(value.name || value.type)
      }
    })
    
    // Find removed elements
    previousElements.forEach((value, id) => {
      if (!currentElements.has(id)) {
        removed.push(value.name || value.type)
      }
    })
    
    return { added, removed, changed: [] }
  } catch {
    return { added: [], removed: [], changed: [] }
  }
}

export default function HistoryPanel({
  snapshots,
  currentIndex,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onGoToSnapshot,
  onClearHistory,
  onClose
}: HistoryPanelProps) {
  // Show snapshots in reverse order (newest first)
  const reversedSnapshots = [...snapshots].reverse()
  const reversedCurrentIndex = snapshots.length - 1 - currentIndex
  
  // Hover preview state
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null)
  const [previewPosition, setPreviewPosition] = React.useState<{ top: number; left: number } | null>(null)
  const hoverTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  
  // Compute diff for hovered snapshot
  const hoveredDiff = React.useMemo(() => {
    if (hoveredIndex === null) return null
    const currentXml = snapshots[hoveredIndex]?.xml
    const previousXml = hoveredIndex > 0 ? snapshots[hoveredIndex - 1]?.xml : undefined
    return getSnapshotDiff(currentXml, previousXml)
  }, [hoveredIndex, snapshots])
  
  const hoveredStats = React.useMemo(() => {
    if (hoveredIndex === null) return null
    const xml = snapshots[hoveredIndex]?.xml
    return xml ? getSnapshotStats(xml) : null
  }, [hoveredIndex, snapshots])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ 
        padding: 'var(--spacing-3)', 
        borderBottom: '1px solid var(--color-border-primary)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h4 style={{ margin: 0, fontSize: 'var(--text-14)', fontWeight: 'var(--font-weight-semibold)' }}>
          History
        </h4>
        <Button kind="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>

      {/* Undo/Redo buttons */}
      <div style={{ 
        padding: 'var(--spacing-2) var(--spacing-3)',
        borderBottom: '1px solid var(--color-border-primary)',
        display: 'flex',
        gap: 'var(--spacing-2)'
      }}>
        <Button 
          kind="ghost" 
          size="sm" 
          disabled={!canUndo}
          onClick={onUndo}
          renderIcon={Undo}
          iconDescription="Undo"
        >
          Undo
        </Button>
        <Button 
          kind="ghost" 
          size="sm" 
          disabled={!canRedo}
          onClick={onRedo}
          renderIcon={Redo}
          iconDescription="Redo"
        >
          Redo
        </Button>
        <div style={{ flex: 1 }} />
        <Button 
          kind="ghost" 
          size="sm"
          onClick={onClearHistory}
          renderIcon={TrashCan}
          iconDescription="Clear history"
          hasIconOnly
          tooltipPosition="bottom"
        />
      </div>

      {/* Snapshot count */}
      <div style={{ 
        padding: 'var(--spacing-2) var(--spacing-3)',
        fontSize: 'var(--text-12)',
        color: 'var(--color-text-tertiary)',
        borderBottom: '1px solid var(--color-border-primary)'
      }}>
        {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''} • 
        Position {currentIndex + 1} of {snapshots.length}
      </div>

      {/* Snapshots list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {snapshots.length === 0 ? (
          <div style={{ 
            padding: 'var(--spacing-4)', 
            textAlign: 'center',
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--text-12)'
          }}>
            No history yet. Make some changes to start tracking.
          </div>
        ) : (
          <div style={{ padding: 'var(--spacing-2) 0' }}>
            {reversedSnapshots.map((snapshot, reversedIdx) => {
              const actualIndex = snapshots.length - 1 - reversedIdx
              const isCurrent = actualIndex === currentIndex
              const isFuture = actualIndex > currentIndex
              
              return (
                <button
                  key={`${snapshot.timestamp}-${reversedIdx}`}
                  onClick={() => onGoToSnapshot(actualIndex)}
                  style={{
                    width: '100%',
                    padding: 'var(--spacing-2) var(--spacing-3)',
                    border: 'none',
                    background: isCurrent 
                      ? 'var(--color-bg-tertiary)' 
                      : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--spacing-2)',
                    opacity: isFuture ? 0.5 : 1,
                    borderLeft: isCurrent 
                      ? '3px solid var(--color-primary)' 
                      : '3px solid transparent',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isCurrent) {
                      e.currentTarget.style.background = 'var(--color-bg-secondary)'
                    }
                    // Show preview after 300ms delay
                    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
                    const target = e.currentTarget
                    hoverTimeoutRef.current = setTimeout(() => {
                      const rect = target.getBoundingClientRect()
                      // Position to the left of the panel, or below if not enough space
                      const left = rect.left > 220 ? rect.left - 220 : rect.right + 10
                      const top = Math.min(rect.top, window.innerHeight - 300)
                      setPreviewPosition({ top, left })
                      setHoveredIndex(actualIndex)
                    }, 300)
                  }}
                  onMouseLeave={(e) => {
                    if (!isCurrent) {
                      e.currentTarget.style.background = 'transparent'
                    }
                    // Clear preview
                    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
                    setHoveredIndex(null)
                    setPreviewPosition(null)
                  }}
                  title={formatTimeExact(snapshot.timestamp)}
                >
                  {/* Timeline dot */}
                  <div style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: isCurrent 
                      ? 'var(--color-primary)' 
                      : 'var(--color-border-primary)',
                    marginTop: 4,
                    flexShrink: 0
                  }} />
                  
                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {(() => {
                      const { action, elementName } = parseLabel(snapshot.label)
                      return (
                        <>
                          {/* Row 1: Action */}
                          <div style={{ 
                            fontSize: 'var(--text-14)',
                            fontWeight: isCurrent ? 'var(--font-weight-semibold)' : 'normal',
                            color: 'var(--color-text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}>
                            {action}
                            {isCurrent && (
                              <span style={{ 
                                marginLeft: 'var(--spacing-2)',
                                fontSize: 'var(--text-12)',
                                color: 'var(--color-primary)',
                                fontWeight: 'normal'
                              }}>
                                (current)
                              </span>
                            )}
                            {isFuture && (
                              <span style={{ 
                                marginLeft: 'var(--spacing-2)',
                                fontSize: 'var(--text-12)',
                                color: 'var(--color-text-tertiary)',
                                fontWeight: 'normal'
                              }}>
                                (redo)
                              </span>
                            )}
                          </div>
                          {/* Row 2: Element name (if present) */}
                          {elementName && (
                            <div style={{ 
                              fontSize: 'var(--text-12)',
                              color: 'var(--color-text-secondary)',
                              marginTop: 2,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              fontStyle: 'italic'
                            }}>
                              {elementName}
                            </div>
                          )}
                          {/* Row 3: Time */}
                          <div style={{ 
                            fontSize: 'var(--text-12)',
                            color: 'var(--color-text-tertiary)',
                            marginTop: 2
                          }}>
                            {formatTime(snapshot.timestamp)}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div style={{ 
        padding: 'var(--spacing-2) var(--spacing-3)',
        borderTop: '1px solid var(--color-border-primary)',
        fontSize: 'var(--text-12)',
        color: 'var(--color-text-tertiary)'
      }}>
        💡 Click any snapshot to restore. Max 50 saved.
      </div>
      
      {/* Hover preview tooltip */}
      {hoveredIndex !== null && previewPosition && (
        <div 
          style={{
            position: 'fixed',
            top: previewPosition.top,
            left: previewPosition.left,
            width: 200,
            background: '#1a1a1a',
            border: '1px solid #444',
            borderRadius: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            padding: '12px',
            zIndex: 99999,
            fontSize: '12px',
            color: '#fff',
            pointerEvents: 'none'
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '8px', color: '#fff' }}>
            Snapshot Preview
          </div>
          
          {/* Stats */}
          {hoveredStats && (
            <div style={{ marginBottom: '8px', color: '#ccc' }}>
              <div>📦 {hoveredStats.tasks} tasks</div>
              <div>🔀 {hoveredStats.gateways} gateways</div>
              <div>⚡ {hoveredStats.events} events</div>
              <div>➡️ {hoveredStats.connections} connections</div>
            </div>
          )}
          
          {/* Diff from previous */}
          {hoveredDiff && (hoveredDiff.added.length > 0 || hoveredDiff.removed.length > 0) && (
            <div style={{ borderTop: '1px solid #444', paddingTop: '8px' }}>
              <div style={{ fontWeight: 600, marginBottom: '4px', color: '#fff' }}>
                Changes from previous:
              </div>
              {hoveredDiff.added.slice(0, 3).map((name, i) => (
                <div key={`add-${i}`} style={{ color: '#4ade80' }}>
                  + {name}
                </div>
              ))}
              {hoveredDiff.added.length > 3 && (
                <div style={{ color: '#4ade80' }}>
                  + {hoveredDiff.added.length - 3} more...
                </div>
              )}
              {hoveredDiff.removed.slice(0, 3).map((name, i) => (
                <div key={`rem-${i}`} style={{ color: '#f87171' }}>
                  − {name}
                </div>
              ))}
              {hoveredDiff.removed.length > 3 && (
                <div style={{ color: '#f87171' }}>
                  − {hoveredDiff.removed.length - 3} more...
                </div>
              )}
            </div>
          )}
          
          {/* No changes detected */}
          {hoveredDiff && hoveredDiff.added.length === 0 && hoveredDiff.removed.length === 0 && hoveredIndex > 0 && (
            <div style={{ color: '#888', fontStyle: 'italic' }}>
              Position/property change
            </div>
          )}
          
          {/* Initial state */}
          {hoveredIndex === 0 && (
            <div style={{ color: '#888', fontStyle: 'italic' }}>
              Initial state
            </div>
          )}
        </div>
      )}
    </div>
  )
}
