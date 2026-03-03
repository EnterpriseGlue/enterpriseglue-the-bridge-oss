import React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'

type RenameConfig = {
  type?: 'project' | 'file' | 'folder'
  getEndpoint?: (id: string) => string
  queryKey: any[]
}

export function useInlineRename(config: RenameConfig) {
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draftName, setDraftName] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const queryClient = useQueryClient()

  const startEditing = React.useCallback((id: string, currentName: string) => {
    setEditingId(id)
    setDraftName(currentName)
  }, [])

  const cancelEditing = React.useCallback(() => {
    setEditingId(null)
    setDraftName('')
  }, [])

  const saveRename = React.useCallback(async (id: string, nextName: string) => {
    const name = nextName.trim()
    if (!name) {
      cancelEditing()
      return
    }

    try {
      let endpoint = ''
      
      if (config.getEndpoint) {
        endpoint = config.getEndpoint(id)
      } else if (config.type) {
        switch (config.type) {
          case 'project':
            endpoint = `/starbase-api/projects/${id}`
            break
          case 'folder':
            endpoint = `/starbase-api/folders/${id}`
            break
          case 'file':
            endpoint = `/starbase-api/files/${id}`
            break
        }
      } else {
        throw new Error('Either type or getEndpoint must be provided')
      }

      await apiClient.patch(endpoint, { name })
      
      cancelEditing()
      await queryClient.invalidateQueries({ queryKey: config.queryKey })
    } catch {
      cancelEditing()
    }
  }, [config, queryClient, cancelEditing])

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
