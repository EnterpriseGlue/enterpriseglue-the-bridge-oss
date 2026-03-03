import { useState, useCallback } from 'react'

interface ModalState {
  open: boolean
  data?: any
}

/**
 * Custom hook to manage modal state
 * Provides consistent modal management across the application
 * 
 * @example
 * const { isOpen, data, openModal, closeModal } = useModal()
 * 
 * // Open modal with optional data
 * openModal({ userId: 123 })
 * 
 * // Close modal
 * closeModal()
 */
export function useModal<T = any>() {
  const [modalState, setModalState] = useState<ModalState>({
    open: false,
    data: undefined
  })

  const openModal = useCallback((data?: T) => {
    setModalState({
      open: true,
      data
    })
  }, [])

  const closeModal = useCallback(() => {
    setModalState({
      open: false,
      data: undefined
    })
  }, [])

  return {
    isOpen: modalState.open,
    data: modalState.data as T | undefined,
    openModal,
    closeModal
  }
}
