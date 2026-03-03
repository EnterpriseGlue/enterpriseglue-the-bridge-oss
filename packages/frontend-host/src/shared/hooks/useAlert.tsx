import { useState, useCallback } from 'react'

interface AlertState {
  open: boolean
  message: string
  title?: string
  kind?: 'error' | 'warning' | 'info'
}

/**
 * Custom hook to manage alert modal state
 * Replaces browser alert() with modal-based alerts
 */
export function useAlert() {
  const [alertState, setAlertState] = useState<AlertState>({
    open: false,
    message: '',
    title: undefined,
    kind: 'info'
  })

  const showAlert = useCallback((message: string, kind: 'error' | 'warning' | 'info' = 'info', title?: string) => {
    setAlertState({
      open: true,
      message,
      title,
      kind
    })
  }, [])

  const closeAlert = useCallback(() => {
    setAlertState(prev => ({ ...prev, open: false }))
  }, [])

  return {
    alertState,
    showAlert,
    closeAlert
  }
}
