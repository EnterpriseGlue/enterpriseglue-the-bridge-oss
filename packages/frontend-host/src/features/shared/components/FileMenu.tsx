import React from 'react'
import { apiClient } from '../../../shared/api/client'
import { downloadBlob, toSafeDownloadFilename } from '../../../utils/safeDom'

interface FileMenuProps {
  fileId: string | undefined
  fileName: string | undefined
  fileType: 'bpmn' | 'dmn' | undefined
  displayFileName: string | undefined
  onRename: () => void
}

export default function FileMenu({ 
  fileId, 
  fileName, 
  fileType, 
  displayFileName, 
  onRename
}: FileMenuProps) {
  const [menuOpen, setMenuOpen] = React.useState(false)

  // Close menu on outside click
  React.useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest?.('#file-crumb-menu-anchor')) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  const handleDownload = async () => {
    try {
      if (!fileId) return
      const data = await apiClient.get<{ xml?: string }>(`/starbase-api/files/${fileId}`)
      const xml = String((data && data.xml) || '')
      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' })
      const ext = fileType === 'dmn' ? 'dmn' : 'bpmn'
      const safeName = toSafeDownloadFilename(`${displayFileName || 'diagram'}.${ext}`, `diagram.${ext}`)
      downloadBlob(blob, safeName)
    } catch {}
    setMenuOpen(false)
  }

  return (
    <div id="file-crumb-menu-anchor" style={{ position: 'relative', display: 'inline-block' }}>
      <button
        aria-label="File actions"
        onClick={(e) => { e.preventDefault(); setMenuOpen((v) => !v) }}
        style={{
          marginLeft: 6,
          border: 'none',
          background: 'transparent',
          padding: 0,
          lineHeight: 0,
          cursor: 'pointer'
        }}
      >
        <svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 12l8 8 8-8" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {menuOpen && (
        <div style={{ 
          position: 'absolute', 
          top: '140%', 
          right: 0, 
          background: 'var(--color-bg-primary)', 
          boxShadow: 'var(--shadow-md)', 
          borderRadius: 'var(--border-radius-sm)', 
          padding: 'var(--spacing-2) 0', 
          minWidth: 220, 
          zIndex: 'var(--z-popover)' 
        }}>
          <button 
            className="create-menu-item" 
            onClick={() => { setMenuOpen(false); onRename() }} 
            style={{ 
              width: '100%', 
              textAlign: 'left', 
              padding: 'var(--spacing-2) var(--spacing-4)', 
              background: 'transparent', 
              border: 'none', 
              cursor: 'pointer', 
              color: 'var(--color-text-primary)' 
            }}
          >
            Rename
          </button>
          <div style={{ borderTop: '1px solid var(--color-border-primary)', margin: 'var(--spacing-2) 0' }} />
          <button
            className="create-menu-item"
            onClick={handleDownload}
            style={{ 
              width: '100%', 
              textAlign: 'left', 
              padding: 'var(--spacing-2) var(--spacing-4)', 
              background: 'transparent', 
              border: 'none', 
              cursor: 'pointer', 
              color: 'var(--color-text-primary)' 
            }}
          >
            Download
          </button>
          <div style={{ borderTop: '1px solid var(--color-border-primary)', margin: 'var(--spacing-2) 0' }} />
          <div className="create-menu-item" style={{ width: '100%', textAlign: 'left', padding: 'var(--spacing-2) var(--spacing-4)', color: 'var(--color-text-tertiary)', cursor: 'not-allowed' }}>
            Replace via upload
          </div>
          <div className="create-menu-item" style={{ width: '100%', textAlign: 'left', padding: 'var(--spacing-2) var(--spacing-4)', color: 'var(--color-text-tertiary)', cursor: 'not-allowed' }}>
            Duplicate
          </div>
          <div className="create-menu-item" style={{ width: '100%', textAlign: 'left', padding: 'var(--spacing-2) var(--spacing-4)', color: 'var(--color-text-tertiary)', cursor: 'not-allowed' }}>
            Delete
          </div>
        </div>
      )}
    </div>
  )
}
