import React from 'react'
import { FolderOpen } from '@carbon/icons-react'
import { PageHeader, PAGE_GRADIENTS } from '../../../../shared/components/PageLayout'
import { GuardedOverflowMenu, GuardedOverflowMenuItem } from '../../../../shared/auth/guards'

interface ProjectDetailHeaderProps {
  projectName: string
  subtitle: string
  projectId?: string | null
  canDownloadProject: boolean
  canOpenGitSettings: boolean
  canOpenDeploymentTargets?: boolean
  downloadProjectUnavailableReason?: string | null
  gitSettingsUnavailableReason?: string | null
  deploymentTargetsUnavailableReason?: string | null
  onDownloadProject: (projectId: string, projectName: string) => void
  onOpenGitSettings?: () => void
  onOpenDeploymentTargets?: () => void
}

export function ProjectDetailHeader({
  projectName,
  subtitle,
  projectId,
  canDownloadProject,
  canOpenGitSettings,
  canOpenDeploymentTargets = false,
  downloadProjectUnavailableReason,
  gitSettingsUnavailableReason,
  deploymentTargetsUnavailableReason,
  onDownloadProject,
  onOpenGitSettings,
  onOpenDeploymentTargets,
}: ProjectDetailHeaderProps) {
  const hasActions = Boolean(projectId)
  const gitSettingsReason = gitSettingsUnavailableReason ?? (canOpenGitSettings ? null : 'Git settings unavailable')
  const deploymentTargetsReason = deploymentTargetsUnavailableReason ?? (canOpenDeploymentTargets ? null : 'Deployment targets unavailable')
  const downloadReason = downloadProjectUnavailableReason ?? (canDownloadProject ? null : 'Project download unavailable')

  return (
    <PageHeader
      icon={FolderOpen}
      title={projectName}
      subtitle={subtitle}
      gradient={PAGE_GRADIENTS.blue}
      actions={hasActions ? (
        <GuardedOverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Project options">
          {onOpenGitSettings && (
            <GuardedOverflowMenuItem
              itemText="Git Settings"
              unavailableReason={gitSettingsReason}
              onClick={onOpenGitSettings}
            />
          )}
          {onOpenDeploymentTargets && (
            <GuardedOverflowMenuItem
              itemText="Deployment Targets"
              unavailableReason={deploymentTargetsReason}
              onClick={onOpenDeploymentTargets}
            />
          )}
          <GuardedOverflowMenuItem
            itemText="Download project"
            unavailableReason={downloadReason}
            onClick={() => {
              if (!projectId) return
              onDownloadProject(projectId, projectName)
            }}
          />
        </GuardedOverflowMenu>
      ) : undefined}
    />
  )
}
