import { useState, useCallback } from 'react'
import { apiClient } from '../../../../../shared/api/client'
import { getUiErrorMessage } from '../../../../../shared/api/apiErrorUtils'

interface UseVariableEditorProps {
  instanceId: string
  varsQ: any
  engineId?: string
}

export function useVariableEditor({ instanceId, varsQ, engineId }: UseVariableEditorProps) {
  const [editingVarKey, setEditingVarKey] = useState<string | null>(null)
  const [editingVarType, setEditingVarType] = useState<string>('String')
  const [editingVarValue, setEditingVarValue] = useState<string>('')
  const [editVarBusy, setEditVarBusy] = useState(false)
  const [editVarError, setEditVarError] = useState<string | null>(null)

  const openVariableEditor = useCallback((name: string, variable?: { value: any; type: string }) => {
    setEditingVarKey(name)
    setEditingVarType(variable?.type || 'String')
    try {
      if (variable?.type === 'Object' || variable?.type === 'Json') {
        setEditingVarValue(JSON.stringify(variable.value, null, 2))
      } else if (variable?.value !== undefined && variable?.value !== null) {
        setEditingVarValue(String(variable.value))
      } else {
        setEditingVarValue('')
      }
    } catch {
      setEditingVarValue(String(variable?.value ?? ''))
    }
    setEditVarError(null)
  }, [])

  const closeVariableEditor = useCallback(() => {
    setEditingVarKey(null)
    setEditingVarValue('')
    setEditingVarType('String')
    setEditVarError(null)
  }, [])

  const submitVariableEdit = useCallback(async () => {
    if (!instanceId || !editingVarKey) return
    setEditVarBusy(true)
    setEditVarError(null)
    try {
      let parsed: any = editingVarValue
      if (editingVarType !== 'String') {
        if (editingVarValue.trim() === '') {
          parsed = null
        } else if (editingVarType === 'Boolean') {
          if (/^(true|false)$/i.test(editingVarValue.trim())) parsed = editingVarValue.trim().toLowerCase() === 'true'
          else throw new Error('Boolean values must be true or false')
        } else if (editingVarType === 'Integer' || editingVarType === 'Long') {
          const num = Number(editingVarValue)
          if (Number.isNaN(num)) throw new Error('Value must be a number')
          parsed = editingVarType === 'Integer' ? Math.trunc(num) : num
        } else if (editingVarType === 'Double') {
          const num = Number(editingVarValue)
          if (Number.isNaN(num)) throw new Error('Value must be a number')
          parsed = num
        } else if (editingVarType === 'Object' || editingVarType === 'Json') {
          parsed = JSON.parse(editingVarValue || '{}')
        }
      }
      const body = { modifications: { [editingVarKey]: { value: parsed, type: editingVarType } }, engineId }
      await apiClient.post(`/mission-control-api/process-instances/${instanceId}/variables`, body, { credentials: 'include' })
      await varsQ.refetch()
      closeVariableEditor()
    } catch (e: any) {
      setEditVarError(getUiErrorMessage(e, 'Failed to update variable'))
    } finally {
      setEditVarBusy(false)
    }
  }, [instanceId, editingVarKey, editingVarValue, editingVarType, varsQ, closeVariableEditor])

  return {
    // State
    editingVarKey,
    editingVarType,
    editingVarValue,
    editVarBusy,
    editVarError,

    // Setters
    setEditingVarKey,
    setEditingVarType,
    setEditingVarValue,
    setEditVarError,

    // Actions
    openVariableEditor,
    closeVariableEditor,
    submitVariableEdit,
  }
}
