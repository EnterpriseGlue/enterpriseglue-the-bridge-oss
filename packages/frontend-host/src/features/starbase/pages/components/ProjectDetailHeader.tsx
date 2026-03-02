import React from 'react'
import { OverflowMenu, OverflowMenuItem } from '@carbon/react'
import { FolderOpen } from '@carbon/icons-react'
import { PageHeader, PAGE_GRADIENTS } from '../../../../shared/components/PageLayout'

interface ProjectDetailHeaderProps {
  projectName: string
  subtitle: string
  projectId?: string | null
  onDownloadProject: (projectId: string, projectName: string) => void
  onOpenGitSettings?: () => void
}

export function ProjectDetailHeader({
  projectName,
  subtitle,
  projectId,
  onDownloadProject,
  onOpenGitSettings,
}: ProjectDetailHeaderProps) {
  return (
    <PageHeader
      icon={FolderOpen}
      title={projectName}
      subtitle={subtitle}
      gradient={PAGE_GRADIENTS.blue}
      actions={
        <OverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Project options">
          {onOpenGitSettings && (
            <OverflowMenuItem
              itemText="Git Settings"
              onClick={onOpenGitSettings}
            />
          )}
          <OverflowMenuItem
            itemText="Download project"
            onClick={() => {
              if (!projectId) return
              onDownloadProject(projectId, projectName)
            }}
          />
        </OverflowMenu>
      }
    />
  )
}
