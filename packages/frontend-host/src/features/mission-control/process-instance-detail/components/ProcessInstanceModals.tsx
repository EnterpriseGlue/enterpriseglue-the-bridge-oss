import React from 'react'
import AlertModal from '../../../../shared/components/AlertModal'
import { EditVariableModal, AddVariableModal, BulkUploadVariablesModal } from './VariableModals'
import {
  IncidentDetailsModal,
  ModificationIntroModal,
  DiscardConfirmModal,
  TerminateConfirmModal,
  RetryModal,
} from './modals'

interface ProcessInstanceModalsProps {
  incidentDetails: any | null
  jobById: Map<string, any>
  onCloseIncident: () => void
  // Edit variable
  editingVarKey: string | null
  editingVarType: string
  editingVarValue: string
  editVarBusy: boolean
  editVarError: string | null
  setEditingVarType: (value: string) => void
  setEditingVarValue: (value: string) => void
  setEditVarError: (value: string | null) => void
  closeVariableEditor: () => void
  submitVariableEdit: () => void
  // Add variable
  addVariableOpen: boolean
  addVariableName: string
  addVariableType: string
  addVariableValue: string
  addVariableBusy: boolean
  addVariableError: string | null
  setAddVariableName: (value: string) => void
  setAddVariableType: (value: string) => void
  setAddVariableValue: (value: string) => void
  setAddVariableError: (value: string | null) => void
  setAddVariableOpen: (open: boolean) => void
  submitAddVariable: () => void
  // Bulk upload variables
  bulkUploadOpen: boolean
  bulkUploadValue: string
  bulkUploadBusy: boolean
  bulkUploadError: string | null
  setBulkUploadValue: (value: string) => void
  setBulkUploadError: (value: string | null) => void
  setBulkUploadOpen: (open: boolean) => void
  submitBulkUpload: () => void
  // Modification intro
  showModIntro: boolean
  suppressIntroNext: boolean
  setSuppressIntroNext: (next: boolean) => void
  setShowModIntro: (open: boolean) => void
  setIsModMode: (open: boolean) => void
  // Discard confirm
  discardConfirmOpen: boolean
  setDiscardConfirmOpen: (open: boolean) => void
  discardModifications: () => void
  // Terminate confirm
  terminateConfirmOpen: boolean
  instanceId: string
  setTerminateConfirmOpen: (open: boolean) => void
  onTerminate: (id: string) => Promise<void>
  // Retry modal
  retryModalOpen: boolean
  retryBusy: boolean
  retryActivityFilter: string | null
  filteredRetryItems: any[]
  retrySelectionMap: Record<string, boolean>
  retryDueMode: 'keep' | 'set'
  retryDueInput: string
  setRetryModalOpen: (open: boolean) => void
  setRetrySelectionMap: (next: Record<string, boolean>) => void
  setRetryDueMode: (mode: 'keep' | 'set') => void
  setRetryDueInput: (value: string) => void
  setRetryActivityFilter: (value: string | null) => void
  submitRetrySelection: () => void
  // Alert modal
  alertState: { open: boolean; message: string; title?: string; kind?: 'info' | 'warning' | 'error' }
  closeAlert: () => void
}

export function ProcessInstanceModals({
  incidentDetails,
  jobById,
  onCloseIncident,
  editingVarKey,
  editingVarType,
  editingVarValue,
  editVarBusy,
  editVarError,
  setEditingVarType,
  setEditingVarValue,
  setEditVarError,
  closeVariableEditor,
  submitVariableEdit,
  addVariableOpen,
  addVariableName,
  addVariableType,
  addVariableValue,
  addVariableBusy,
  addVariableError,
  setAddVariableName,
  setAddVariableType,
  setAddVariableValue,
  setAddVariableError,
  setAddVariableOpen,
  submitAddVariable,
  bulkUploadOpen,
  bulkUploadValue,
  bulkUploadBusy,
  bulkUploadError,
  setBulkUploadValue,
  setBulkUploadError,
  setBulkUploadOpen,
  submitBulkUpload,
  showModIntro,
  suppressIntroNext,
  setSuppressIntroNext,
  setShowModIntro,
  setIsModMode,
  discardConfirmOpen,
  setDiscardConfirmOpen,
  discardModifications,
  terminateConfirmOpen,
  instanceId,
  setTerminateConfirmOpen,
  onTerminate,
  retryModalOpen,
  retryBusy,
  retryActivityFilter,
  filteredRetryItems,
  retrySelectionMap,
  retryDueMode,
  retryDueInput,
  setRetryModalOpen,
  setRetrySelectionMap,
  setRetryDueMode,
  setRetryDueInput,
  setRetryActivityFilter,
  submitRetrySelection,
  alertState,
  closeAlert,
}: ProcessInstanceModalsProps) {
  return (
    <>
      <IncidentDetailsModal incidentDetails={incidentDetails} jobById={jobById} onClose={onCloseIncident} />

      <EditVariableModal
        editingVarKey={editingVarKey}
        editingVarType={editingVarType}
        editingVarValue={editingVarValue}
        editVarBusy={editVarBusy}
        editVarError={editVarError}
        setEditingVarType={setEditingVarType}
        setEditingVarValue={setEditingVarValue}
        setEditVarError={setEditVarError}
        closeVariableEditor={closeVariableEditor}
        submitVariableEdit={submitVariableEdit}
      />

      <AddVariableModal
        open={addVariableOpen}
        name={addVariableName}
        type={addVariableType}
        value={addVariableValue}
        busy={addVariableBusy}
        error={addVariableError}
        setName={setAddVariableName}
        setType={setAddVariableType}
        setValue={setAddVariableValue}
        setError={setAddVariableError}
        onClose={() => setAddVariableOpen(false)}
        onSubmit={submitAddVariable}
      />

      <BulkUploadVariablesModal
        open={bulkUploadOpen}
        value={bulkUploadValue}
        busy={bulkUploadBusy}
        error={bulkUploadError}
        setValue={setBulkUploadValue}
        setError={setBulkUploadError}
        onClose={() => setBulkUploadOpen(false)}
        onSubmit={submitBulkUpload}
      />

      <ModificationIntroModal
        open={showModIntro}
        suppressIntroNext={suppressIntroNext}
        onSuppressChange={setSuppressIntroNext}
        onClose={() => setShowModIntro(false)}
        onStart={() => {
          setShowModIntro(false)
          setIsModMode(true)
        }}
      />

      <DiscardConfirmModal
        open={discardConfirmOpen}
        onClose={() => setDiscardConfirmOpen(false)}
        onConfirm={() => {
          setDiscardConfirmOpen(false)
          discardModifications()
        }}
      />

      <TerminateConfirmModal
        open={terminateConfirmOpen}
        instanceId={instanceId}
        onClose={() => setTerminateConfirmOpen(false)}
        onTerminate={onTerminate}
      />

      <RetryModal
        open={retryModalOpen}
        retryBusy={retryBusy}
        retryActivityFilter={retryActivityFilter}
        filteredRetryItems={filteredRetryItems}
        retrySelectionMap={retrySelectionMap}
        retryDueMode={retryDueMode}
        retryDueInput={retryDueInput}
        onClose={() => {
          setRetryModalOpen(false)
          setRetrySelectionMap({})
          setRetryDueMode('keep')
          setRetryDueInput('')
          setRetryActivityFilter(null)
        }}
        onSubmit={submitRetrySelection}
        onActivityFilterClear={() => setRetryActivityFilter(null)}
        onDueModeChange={setRetryDueMode}
        onDueInputChange={setRetryDueInput}
        onSelectionChange={setRetrySelectionMap}
      />

      <AlertModal
        open={alertState.open}
        onClose={closeAlert}
        message={alertState.message}
        title={alertState.title}
        kind={alertState.kind}
      />
    </>
  )
}
