import React from 'react'
import ConfirmDeleteModal from '../../../shared/components/ConfirmDeleteModal'
import { CreateOnlineProjectModal } from '../../../git/components'
import { EngineAccessModal } from '../../components/project-detail/EngineAccessModal'
import type { Project, EngineAccessData } from '../projectOverviewTypes'

interface ProjectOverviewModalsProps {
  batchDeleteIds: string[] | null
  busy: boolean
  onCancelBatchDelete: () => void
  onConfirmBatchDelete: () => void
  deleteProject: Project | null
  onCancelDeleteProject: () => void
  onConfirmDeleteProject: () => void
  disconnectProject: Project | null
  onCancelDisconnectProject: () => void
  onConfirmDisconnectProject: () => void
  createOnlineModalOpen: boolean
  onCloseCreateOnlineModal: () => void
  existingProjectId?: string
  existingProjectName?: string
  engineAccessOpen: boolean
  onCloseEngineAccess: () => void
  engineAccessQ: {
    isLoading: boolean
    isError: boolean
    data?: EngineAccessData
  }
  canManageMembers: boolean
  myMembershipLoading: boolean
  selectedEngineForRequest: string | null
  setSelectedEngineForRequest: (id: string | null) => void
  requestEngineAccessM: {
    isPending: boolean
    mutate: (engineId: string) => void
  }
}

export function ProjectOverviewModals({
  batchDeleteIds,
  busy,
  onCancelBatchDelete,
  onConfirmBatchDelete,
  deleteProject,
  onCancelDeleteProject,
  onConfirmDeleteProject,
  disconnectProject,
  onCancelDisconnectProject,
  onConfirmDisconnectProject,
  createOnlineModalOpen,
  onCloseCreateOnlineModal,
  existingProjectId,
  existingProjectName,
  engineAccessOpen,
  onCloseEngineAccess,
  engineAccessQ,
  canManageMembers,
  myMembershipLoading,
  selectedEngineForRequest,
  setSelectedEngineForRequest,
  requestEngineAccessM,
}: ProjectOverviewModalsProps) {
  return (
    <>
      <ConfirmDeleteModal
        open={!!batchDeleteIds}
        title="Deleting projects"
        description={
          batchDeleteIds
            ? `You're about to delete ${batchDeleteIds.length} project${batchDeleteIds.length === 1 ? '' : 's'} and their files. Project members won't be able to access them afterwards.`
            : ''
        }
        dangerLabel={busy ? 'Deleting...' : 'Delete projects'}
        busy={busy}
        onCancel={onCancelBatchDelete}
        onConfirm={onConfirmBatchDelete}
      />

      <ConfirmDeleteModal
        open={!!deleteProject}
        title="Deleting project"
        description={
          deleteProject
            ? `You're about to delete the project "${deleteProject.name}" and its files. Project members won't be able to access them afterwards.`
            : ''
        }
        dangerLabel="Delete project"
        busy={busy}
        onCancel={onCancelDeleteProject}
        onConfirm={onConfirmDeleteProject}
      />

      <ConfirmDeleteModal
        open={!!disconnectProject}
        title="Disconnect Git"
        description={
          disconnectProject
            ? `This will disconnect the project "${disconnectProject.name}" from its Git repository. Your local files will remain, but sync with Git will stop.`
            : ''
        }
        dangerLabel="Disconnect"
        busy={busy}
        onCancel={onCancelDisconnectProject}
        onConfirm={onConfirmDisconnectProject}
      />

      <CreateOnlineProjectModal
        open={createOnlineModalOpen}
        onClose={onCloseCreateOnlineModal}
        existingProjectId={existingProjectId}
        existingProjectName={existingProjectName}
      />

      <EngineAccessModal
        open={engineAccessOpen}
        onClose={onCloseEngineAccess}
        engineAccessQ={engineAccessQ}
        canManageMembers={canManageMembers}
        myMembershipLoading={myMembershipLoading}
        selectedEngineForRequest={selectedEngineForRequest}
        setSelectedEngineForRequest={setSelectedEngineForRequest}
        requestEngineAccessM={requestEngineAccessM}
      />
    </>
  )
}
