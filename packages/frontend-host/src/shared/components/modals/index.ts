/**
 * Standardized Modal System
 * 
 * This module provides a consistent modal system across the application.
 * All modals use Carbon Design System components and follow the same patterns.
 */

export { default as AlertModal } from '../AlertModal'
export { default as ConfirmModal } from '../ConfirmModal'
export { default as FormModal } from '../../../components/FormModal'

// Re-export hooks
export { useAlert } from '../../hooks/useAlert'
export { useModal } from '../../hooks/useModal'
