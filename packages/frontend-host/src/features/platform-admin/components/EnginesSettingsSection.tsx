import React from 'react'
import { Button, ComboBox, Checkbox, SkeletonText, Tile, Tag } from '@carbon/react'
import { Chip, UserAvatar, Add, Edit, TrashCan, Draggable } from '@carbon/icons-react'
import { PlatformGrid, PlatformRow, PlatformCol } from './PlatformGrid'
import type { EngineGovernanceItem, EnvironmentTag, PlatformSettings } from '../../../api/platform-admin'

interface EnginesSettingsSectionProps {
  settings: PlatformSettings | undefined
  allEngines: EngineGovernanceItem[] | undefined
  enginesLoading: boolean
  selectedEngine: EngineGovernanceItem | null
  setSelectedEngine: (engine: EngineGovernanceItem | null) => void
  engineComboKey: number
  setEngineComboKey: React.Dispatch<React.SetStateAction<number>>
  onAssignOwner: (target: { id: string; name: string }) => void
  onAssignDelegate: (target: { id: string; name: string }) => void
  onDeployRoleToggle: (role: string, checked: boolean) => void
  envTags: EnvironmentTag[] | undefined
  envLoading: boolean
  onOpenCreateModal: () => void
  onOpenEditModal: (tag: EnvironmentTag) => void
  onDeleteTag: (tag: EnvironmentTag) => void
  draggedTagId: string | null
  dragOverTagId: string | null
  onDragStart: (e: React.DragEvent, tagId: string) => void
  onDragOver: (e: React.DragEvent, tagId: string) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, targetTagId: string) => void
  onDragEnd: () => void
}

const ALL_ROLES = ['owner', 'delegate', 'operator', 'deployer']

export function EnginesSettingsSection({
  settings,
  allEngines,
  enginesLoading,
  selectedEngine,
  setSelectedEngine,
  engineComboKey,
  setEngineComboKey,
  onAssignOwner,
  onAssignDelegate,
  onDeployRoleToggle,
  envTags,
  envLoading,
  onOpenCreateModal,
  onOpenEditModal,
  onDeleteTag,
  draggedTagId,
  dragOverTagId,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: EnginesSettingsSectionProps) {
  const deployRoles = Array.isArray(settings?.defaultDeployRoles) ? settings.defaultDeployRoles : []

  return (
    <PlatformGrid style={{ paddingInline: 0, alignItems: 'stretch' }}>
      <PlatformRow>
        <PlatformCol sm={4} md={4} lg={8} style={{ display: 'flex', flexDirection: 'column', marginInlineStart: 0 }}>
          <Tile style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-4)' }}>
              <Chip size={20} style={{ color: 'var(--color-text-secondary)' }} />
              <div>
                <h3 style={{ margin: '0 0 var(--spacing-1) 0', fontSize: '16px', fontWeight: 600 }}>Engine Governance</h3>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  Assign owners or delegates to workflow engines
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--spacing-4)', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, maxWidth: '400px' }}>
                <ComboBox
                  key={`engine-combo-${engineComboKey}`}
                  id="engine-combobox"
                  titleText="Select Engine"
                  placeholder="Find an engine..."
                  items={allEngines || []}
                  itemToString={(item: EngineGovernanceItem | null) => item?.name || ''}
                  selectedItem={selectedEngine}
                  onChange={({ selectedItem }) => {
                    setSelectedEngine(selectedItem ?? null)
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
                  disabled={!selectedEngine}
                  onClick={() => selectedEngine && onAssignOwner({ id: selectedEngine.id, name: selectedEngine.name })}
                >
                  Assign Owner
                </Button>
                <Button
                  kind="tertiary"
                  size="md"
                  disabled={!selectedEngine}
                  onClick={() => selectedEngine && onAssignDelegate({ id: selectedEngine.id, name: selectedEngine.name })}
                >
                  Assign Delegate
                </Button>
              </div>
            </div>

            {selectedEngine && (
              <Tile style={{ marginTop: 'var(--spacing-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-3)' }}>
                  <Chip size={20} style={{ color: 'var(--cds-interactive-01, #0f62fe)' }} />
                  <span style={{ fontSize: '16px', fontWeight: 600 }}>{selectedEngine.name}</span>
                  <Tag type="gray" size="sm">
                    {selectedEngine.type}
                  </Tag>
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedEngine(null)
                      setEngineComboKey((k) => k + 1)
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
                      {selectedEngine.ownerName || selectedEngine.ownerEmail || (
                        <span style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>Not assigned</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Delegate</div>
                    <div style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <UserAvatar size={16} />
                      {selectedEngine.delegateName || selectedEngine.delegateEmail || (
                        <span style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>Not assigned</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Created</div>
                    <div style={{ fontSize: '14px' }}>{new Date(selectedEngine.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
              </Tile>
            )}
          </Tile>
        </PlatformCol>

        <PlatformCol sm={4} md={4} lg={8} style={{ display: 'flex', flexDirection: 'column', marginInlineEnd: 0 }}>
          <Tile style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 var(--spacing-2) 0', fontSize: '16px', fontWeight: 600 }}>Default Engine Deploy Permissions</h3>
            <p style={{ margin: '0 0 var(--spacing-4) 0', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
              Project roles that can deploy to engines by default.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)' }}>
              {ALL_ROLES.map((role) => {
                const isChecked = deployRoles.includes(role)
                return (
                  <Checkbox
                    key={role}
                    id={`deploy-role-${role}`}
                    labelText={role.charAt(0).toUpperCase() + role.slice(1)}
                    checked={isChecked}
                    onChange={(_, { checked }) => onDeployRoleToggle(role, checked)}
                  />
                )
              })}
            </div>
          </Tile>
        </PlatformCol>
      </PlatformRow>

      <PlatformRow>
        <PlatformCol sm={4} md={8} lg={16} style={{ marginInlineStart: 0, marginInlineEnd: 0 }}>
          <Tile style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--spacing-4)' }}>
              <div>
                <h3 style={{ margin: '0 0 var(--spacing-2) 0', fontSize: '16px', fontWeight: 600 }}>Engine Environments</h3>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                  Define deployment environments like Dev, Test, Staging, Production.
                </p>
              </div>
              <Button kind="tertiary" size="sm" renderIcon={Add} onClick={onOpenCreateModal}>
                Add
              </Button>
            </div>

            {envLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                <SkeletonText width="220px" />
                <SkeletonText width="260px" />
                <SkeletonText width="240px" />
                <SkeletonText width="200px" />
              </div>
            ) : Array.isArray(envTags) && envTags.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
                {envTags.map((tag) => (
                  <div
                    key={tag.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, tag.id)}
                    onDragOver={(e) => onDragOver(e, tag.id)}
                    onDragLeave={onDragLeave}
                    onDrop={(e) => onDrop(e, tag.id)}
                    onDragEnd={onDragEnd}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: 'var(--spacing-3)',
                      background:
                        dragOverTagId === tag.id
                          ? 'var(--cds-layer-accent-01, #e0e0e0)'
                          : draggedTagId === tag.id
                            ? 'var(--cds-layer-02, #f4f4f4)'
                            : 'var(--cds-layer-02, #ffffff)',
                      borderRadius: '4px',
                      border:
                        dragOverTagId === tag.id
                          ? '2px dashed var(--cds-interactive-01, #0f62fe)'
                          : '1px solid var(--cds-border-subtle-01, #e0e0e0)',
                      gap: 'var(--spacing-3)',
                      cursor: 'grab',
                      opacity: draggedTagId === tag.id ? 0.5 : 1,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <Draggable size={16} style={{ color: 'var(--color-text-secondary)', flexShrink: 0, cursor: 'grab' }} />
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontWeight: 500, fontSize: '14px' }}>{tag.name}</span>
                    <Tag type={tag.manualDeployAllowed ? 'green' : 'red'} size="sm">
                      {tag.manualDeployAllowed ? 'Manual OK' : 'CI/CD Only'}
                    </Tag>
                    <Button kind="ghost" size="sm" hasIconOnly renderIcon={Edit} iconDescription="Edit" onClick={() => onOpenEditModal(tag)} />
                    <Button kind="ghost" size="sm" hasIconOnly renderIcon={TrashCan} iconDescription="Delete" onClick={() => onDeleteTag(tag)} />
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: 0 }}>No environments configured yet.</p>
            )}
          </Tile>
        </PlatformCol>
      </PlatformRow>
    </PlatformGrid>
  )
}
