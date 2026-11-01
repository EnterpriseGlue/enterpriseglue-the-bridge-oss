import React from 'react'
import { getBrowserSessionRevision } from '../../../utils/browserSession'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'

type RenameConfig = {
  type?: 'project' | 'file' | 'folder'
  getEndpoint?: (id: string) => string
  scopeKey?: string
  write?: (id: string, name: string, check: () => void) => Promise<void>
  onError?: () => void
  queryKey: any[]
}

export function useInlineRename(config: RenameConfig) {
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draftName, setDraftName] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const queryClient = useQueryClient()
  const lifetime = React.useRef({ scope: config.scopeKey, epoch: 0 })
  if (lifetime.current.scope !== config.scopeKey) lifetime.current = { scope: config.scopeKey, epoch: lifetime.current.epoch + 1 }
  const mounted = React.useRef(true), active = React.useRef<object | null>(null)
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  React.useEffect(() => { active.current = null; setEditingId(null); setDraftName('') }, [config.scopeKey])

  const renderEpoch = lifetime.current.epoch, renderBrowser = getBrowserSessionRevision()

  const startEditing = React.useCallback((id: string, currentName: string) => {
    lifetime.current.epoch++; active.current = null
    setEditingId(id)
    setDraftName(currentName)
  }, [])

  const cancelEditing = React.useCallback(() => {
    lifetime.current.epoch++; active.current = null
    setEditingId(null)
    setDraftName('')
  }, [])

  const saveRename = React.useCallback(async (id: string, nextName: string) => {
    const name = nextName.trim()
    if (!name) {
      cancelEditing()
      return
    }

    const epoch = renderEpoch, browser = renderBrowser, scope = config.scopeKey
    const check = () => { if (!mounted.current || epoch !== lifetime.current.epoch || scope !== lifetime.current.scope || browser !== getBrowserSessionRevision()) throw new Error('Rename context changed') }
    try { check() } catch { return }
    if (active.current) return
    const operation = {}; active.current = operation
    try {
      let endpoint = ''
      
      if (config.getEndpoint) {
        endpoint = config.getEndpoint(id)
      } else if (config.type) {
        switch (config.type) {
          case 'project':
            endpoint = `/starbase-api/projects/${encodeURIComponent(id)}`
            break
          case 'folder':
            endpoint = `/starbase-api/folders/${encodeURIComponent(id)}`
            break
          case 'file':
            endpoint = `/starbase-api/files/${encodeURIComponent(id)}`
            break
        }
      } else {
        throw new Error('Either type or getEndpoint must be provided')
      }

      check()
      if (config.write) await config.write(id, name, check)
      else await apiClient.patch(endpoint, { name })
      check()
      await queryClient.invalidateQueries({ queryKey: config.queryKey }, { throwOnError: true }); check()
      cancelEditing()
    } catch {
      try { check(); config.onError?.(); cancelEditing() } catch {}
    } finally { if (active.current === operation) active.current = null }
  }, [config, queryClient, cancelEditing, renderEpoch, renderBrowser])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') saveRename(id, draftName)
    if (e.key === 'Escape') cancelEditing()
  }, [draftName, saveRename, cancelEditing])

  const handleBlur = React.useCallback((id: string) => {
    saveRename(id, draftName)
  }, [draftName, saveRename])

  React.useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  return {
    editingId,
    draftName,
    setDraftName,
    inputRef,
    startEditing,
    cancelEditing,
    saveRename,
    handleKeyDown,
    handleBlur
  }
}
