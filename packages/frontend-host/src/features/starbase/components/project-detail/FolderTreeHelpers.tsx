/**
 * Folder Tree Helper Components
 * Used in move modals to display and select folder destinations
 */

import React from 'react'
import { apiClient } from '../../../../shared/api/client'
import type { FolderSummary } from './project-detail-utils'

interface LoaderProps {
  projectId: string
  onLoaded: (list: FolderSummary[]) => void
}

/**
 * Tiny loader component to fetch folders list while modal mounts
 */
export function FolderLoader({ projectId, onLoaded }: LoaderProps) {
  React.useEffect(() => {
    let active = true
    
    async function run() {
      try {
        const data = await apiClient.get<FolderSummary[]>(`/starbase-api/projects/${projectId}/folders`)
        if (active && Array.isArray(data) && data.length > 0) {
          onLoaded(data)
          return
        }
      } catch {}
      
      // Fallback: crawl via contents API (BFS)
      const out: FolderSummary[] = []
      const seen = new Set<string>()
      const queue: (string | null)[] = [null]
      
      while (queue.length) {
        const fid = queue.shift()!
        try {
          const c = await apiClient.get<any>(
            `/starbase-api/projects/${projectId}/contents`,
            fid ? { folderId: fid } : undefined
          )
          const folders: any[] = Array.isArray(c?.folders) ? c.folders : []
          for (const f of folders) {
            if (!seen.has(f.id)) {
              seen.add(f.id)
              out.push({ id: f.id, name: f.name, parentFolderId: f.parentFolderId ?? null })
              queue.push(f.id)
            }
          }
        } catch {}
      }
      if (active) onLoaded(out)
    }
    
    run()
    return () => {
      active = false
    }
  }, [projectId, onLoaded])
  
  return <div style={{ fontSize: 12, color: '#8d8d8d', marginBottom: 8 }}>Loading folders…</div>
}

interface CurrentPathProps {
  allFolders: FolderSummary[]
  folderId: string
  projectName: string
}

/**
 * Display current folder path for context in move modal
 */
export function CurrentPath({ allFolders, folderId, projectName }: CurrentPathProps) {
  const map = React.useMemo(() => {
    const m = new Map<string, FolderSummary>()
    for (const f of allFolders) m.set(f.id, f)
    return m
  }, [allFolders])
  
  const parts: string[] = []
  let cur: string | null = folderId
  while (cur) {
    const f = map.get(cur)
    if (!f) break
    parts.unshift(f.name)
    cur = f.parentFolderId
  }
  
  const path = parts.length ? `Current: ${parts.join(' / ')}` : `Current: ${projectName}`
  return <div style={{ fontSize: 12, color: '#6f6f6f', marginBottom: 8 }}>{path}</div>
}

interface TreePickerProps {
  allFolders: FolderSummary[]
  value: string | 'ROOT'
  onChange: (v: string | 'ROOT') => void
  disabledSet: Set<string>
  projectName: string
}

/**
 * Tree picker component for selecting folder destination
 */
export function TreePicker({ allFolders, value, onChange, disabledSet, projectName }: TreePickerProps) {
  const { children, roots, byId } = React.useMemo(() => {
    const children = new Map<string, FolderSummary[]>()
    const roots: FolderSummary[] = []
    const byId = new Map<string, FolderSummary>()
    
    for (const f of allFolders) {
      byId.set(f.id, f)
      if (f.parentFolderId) {
        const arr = children.get(f.parentFolderId) || []
        arr.push(f)
        children.set(f.parentFolderId, arr)
      } else {
        roots.push(f)
      }
    }
    
    for (const [, arr] of children) arr.sort((a, b) => a.name.localeCompare(b.name))
    roots.sort((a, b) => a.name.localeCompare(b.name))
    
    return { children, roots, byId }
  }, [allFolders])

  function renderNode(
    id: string | 'ROOT',
    isLast: boolean,
    ancestors: boolean[],
    rows: React.ReactElement[]
  ) {
    const isRoot = id === 'ROOT'
    const disabled = !isRoot && disabledSet.has(id as string)
    const selected = String(value) === String(id)
    const label = isRoot ? projectName : byId.get(id as string)?.name || ''
    const kids = isRoot ? roots : children.get(id as string) || []

    const prefix =
      ancestors.map((hasMore) => (hasMore ? '│  ' : '   ')).join('') +
      (isRoot ? '' : isLast ? '└─ ' : '├─ ')

    rows.push(
      <label
        key={`row-${id}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 6px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <input
          type="radio"
          name="move-target"
          disabled={disabled}
          checked={selected}
          onChange={() => onChange(id)}
        />
        <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', whiteSpace: 'pre' }}>
          {prefix}
          {label}
        </span>
      </label>
    )

    kids.forEach((child, idx) => {
      const childIsLast = idx === kids.length - 1
      renderNode(child.id, childIsLast, [...ancestors, !isLast && !isRoot], rows)
    })
  }

  const rows: React.ReactElement[] = []
  renderNode('ROOT', true, [], rows)

  return (
    <div
      style={{
        maxHeight: 280,
        overflow: 'auto',
        border: '1px solid var(--color-border-primary)',
        padding: 'var(--spacing-2)',
      }}
    >
      {rows}
    </div>
  )
}
