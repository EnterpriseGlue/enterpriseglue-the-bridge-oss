import React from 'react'
import { Button, ComboBox, Tile } from '@carbon/react'
import { Folder, UserAvatar } from '@carbon/icons-react'
import { PlatformGrid, PlatformRow, PlatformCol } from './PlatformGrid'
import type { ProjectGovernanceItem } from '../../../api/platform-admin'

interface ProjectsSettingsSectionProps {
  allProjects: ProjectGovernanceItem[] | undefined
  projectsLoading: boolean
  selectedProject: ProjectGovernanceItem | null
  setSelectedProject: (project: ProjectGovernanceItem | null) => void
  projectComboKey: number
  setProjectComboKey: React.Dispatch<React.SetStateAction<number>>
  onAssignOwner: (target: { id: string; name: string }) => void
  onAssignDelegate: (target: { id: string; name: string }) => void
}

export function ProjectsSettingsSection({
  allProjects,
  projectsLoading,
  selectedProject,
  setSelectedProject,
  projectComboKey,
  setProjectComboKey,
  onAssignOwner,
  onAssignDelegate,
}: ProjectsSettingsSectionProps) {
  return (
    <PlatformGrid style={{ paddingInline: 0 }}>
      <PlatformRow>
        <PlatformCol sm={4} md={8} lg={16} style={{ marginInlineStart: 0, marginInlineEnd: 0 }}>
          <Tile>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-4)' }}>
              <Folder size={20} style={{ color: 'var(--color-text-secondary)' }} />
              <div>
                <h3 style={{ margin: '0 0 var(--spacing-1) 0', fontSize: '16px', fontWeight: 600 }}>
                  Project Governance
                </h3>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  Assign owners or delegates to projects (for employee departures, recovery)
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--spacing-4)', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, maxWidth: '400px' }}>
                <ComboBox
                  key={`project-combo-${projectComboKey}`}
                  id="project-combobox"
                  titleText="Select Project"
                  placeholder="Find a project..."
                  items={allProjects || []}
                  itemToString={(item: ProjectGovernanceItem | null) => item?.name || ''}
                  selectedItem={selectedProject}
                  onChange={({ selectedItem }) => {
                    setSelectedProject(selectedItem ?? null)
                  }}
                  shouldFilterItem={({ item, inputValue }) =>
                    !inputValue || item.name.toLowerCase().includes(inputValue.toLowerCase())
                  }
                  size="md"
                />
              </div>

              <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
                <Button
                  kind="tertiary"
                  size="md"
                  disabled={!selectedProject}
                  onClick={() => selectedProject && onAssignOwner({ id: selectedProject.id, name: selectedProject.name })}
                >
                  Assign Owner
                </Button>
                <Button
                  kind="tertiary"
                  size="md"
                  disabled={!selectedProject}
                  onClick={() => selectedProject && onAssignDelegate({ id: selectedProject.id, name: selectedProject.name })}
                >
                  Assign Delegate
                </Button>
              </div>
            </div>

            {selectedProject && (
              <Tile style={{ marginTop: 'var(--spacing-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-3)' }}>
                  <Folder size={20} style={{ color: 'var(--cds-interactive-01, #0f62fe)' }} />
                  <span style={{ fontSize: '16px', fontWeight: 600 }}>{selectedProject.name}</span>
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedProject(null)
                      setProjectComboKey((k) => k + 1)
                    }}
                    style={{ marginLeft: 'auto' }}
                  >
                    Clear
                  </Button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-3)' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Owner</div>
                    <div style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <UserAvatar size={16} />
                      {selectedProject.ownerName || selectedProject.ownerEmail || (
                        <span style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>Not assigned</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Delegate</div>
                    <div style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <UserAvatar size={16} />
                      {selectedProject.delegateName || selectedProject.delegateEmail || (
                        <span style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>Not assigned</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Created</div>
                    <div style={{ fontSize: '14px' }}>{new Date(selectedProject.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
              </Tile>
            )}
          </Tile>
        </PlatformCol>
      </PlatformRow>
    </PlatformGrid>
  )
}
