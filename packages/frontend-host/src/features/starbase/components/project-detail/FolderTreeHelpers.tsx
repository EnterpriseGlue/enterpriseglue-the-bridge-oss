/**
 * Folder Tree Helper Components
 * Used in move modals to display and select folder destinations
 */

import React from 'react'
import { foldersApi } from '../../../../api/starbase/folders'
import { FolderListResponseSchema } from '@enterpriseglue/shared/schemas/starbase/folder.js'
import type { FolderSummary } from './project-detail-utils'

interface LoaderProps {
  projectId: string
  onLoaded: (list: FolderSummary[]) => void
}

/**
 * Tiny loader component to fetch folders list while modal mounts
 */
export function FolderLoader({ projectId, onLoaded }: LoaderProps) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let active = true; setFailed(false);
    void foldersApi.listByProject(projectId).then(rows => { if (active) onLoaded(rows); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [projectId, onLoaded]);
  return <div role={failed ? 'alert' : 'status'} style={{ fontSize: 12, marginBottom: 8 }}>{failed ? 'Folder tree unavailable. Refresh before moving items.' : 'Loading folders…'}</div>;

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
  
  if (!FolderListResponseSchema.safeParse(allFolders).success) return <div role="alert">Folder path unavailable.</div>
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

  if (!FolderListResponseSchema.safeParse(allFolders).success) return <div role="alert">Folder tree unavailable.</div>
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
