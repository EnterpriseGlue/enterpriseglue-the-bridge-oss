import { useState, useCallback, useEffect, useRef } from 'react'
import { getUiErrorMessage } from '../../../../../shared/api/apiErrorUtils'
import { modifyProcessInstanceVariables } from '../../api/processInstances'

interface UseVariableEditorProps {
  instanceId: string
  varsQ: any
  engineId?: string
  onVariableSaved?: (name: string, variable: { value: any; type: string }) => void
}

export function useVariableEditor({ instanceId, varsQ, engineId, onVariableSaved }: UseVariableEditorProps) {
  const [editingVarKey, setEditingVarKey] = useState<string | null>(null)
  const [editingVarType, setEditingVarType] = useState<string>('String')
  const [editingVarValue, setEditingVarValue] = useState<string>('')
  const [editVarBusy, setEditVarBusy] = useState(false)
  const [editVarError, setEditVarError] = useState<string | null>(null)
  const currentEngineIdRef = useRef(engineId)
  const editingEngineIdRef = useRef<string | undefined>(undefined)
  const editorRevisionRef = useRef(0)
  currentEngineIdRef.current = engineId

  const resetVariableEditor = useCallback(() => {
    editorRevisionRef.current += 1
    editingEngineIdRef.current = undefined
    setEditingVarKey(null)
    setEditingVarValue('')
    setEditingVarType('String')
    setEditVarBusy(false)
    setEditVarError(null)
  }, [])

  useEffect(() => {
    const boundEngineId = editingEngineIdRef.current
    if (boundEngineId && boundEngineId !== engineId) resetVariableEditor()
  }, [engineId, resetVariableEditor])

  const openVariableEditor = useCallback((name: string, variable?: { value: any; type: string }) => {
    if (!currentEngineIdRef.current) return
    editorRevisionRef.current += 1
    editingEngineIdRef.current = currentEngineIdRef.current
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
    resetVariableEditor()
  }, [resetVariableEditor])

  const submitVariableEdit = useCallback(async () => {
    if (!instanceId || !editingVarKey) return
    if (!engineId || editingEngineIdRef.current !== engineId) {
      resetVariableEditor()
      return
    }
    const requestEngineId = editingEngineIdRef.current
    const requestRevision = editorRevisionRef.current
    const isCurrentRequest = () => (
      editorRevisionRef.current === requestRevision
      && currentEngineIdRef.current === requestEngineId
    )
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
      await modifyProcessInstanceVariables(instanceId, {
        modifications: { [editingVarKey]: { value: parsed, type: editingVarType } },
        engineId: requestEngineId,
      })
      if (!isCurrentRequest()) return
      await varsQ.refetch()
      if (!isCurrentRequest()) return
      onVariableSaved?.(editingVarKey, { value: parsed, type: editingVarType })
      closeVariableEditor()
    } catch (e: any) {
      if (isCurrentRequest()) setEditVarError(getUiErrorMessage(e, 'Failed to update variable'))
    } finally {
      if (isCurrentRequest()) setEditVarBusy(false)
    }
  }, [instanceId, editingVarKey, editingVarValue, editingVarType, engineId, varsQ, onVariableSaved, closeVariableEditor, resetVariableEditor])

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
