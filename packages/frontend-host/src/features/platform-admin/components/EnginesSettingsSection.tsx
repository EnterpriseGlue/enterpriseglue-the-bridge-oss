import React from 'react'
import { Button, ComboBox, Checkbox, Dropdown, InlineNotification, SkeletonText, Tile, Tag } from '@carbon/react'
import { Chip, UserAvatar, Add, Edit, TrashCan, Draggable } from '@carbon/icons-react'
import { PlatformGrid, PlatformRow, PlatformCol } from './PlatformGrid'
import type {
  EngineGovernanceItem,
  EnvironmentTag,
  AccessAuthorityMode,
  EngineOnboardingMode,
  PlatformSettings,
  ProjectEngineTargetPolicyMode,
} from '../../../api/platform-admin'

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
  onEngineOnboardingModeChange: (mode: EngineOnboardingMode) => void
  onProjectEngineTargetModeChange: (mode: ProjectEngineTargetPolicyMode) => void
  onEngineAccessAuthorityChange: (mode: AccessAuthorityMode) => void
  onProjectAccessAuthorityChange: (mode: AccessAuthorityMode) => void
  onCredentiallessCustomerSidecarsEnabledChange: (enabled: boolean) => void
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
  canManageSettings?: boolean
  settingsUnavailableReason?: string | null
  canReadGovernance?: boolean
  canManageGovernance?: boolean
  governanceReadUnavailableReason?: string | null
  governanceManageUnavailableReason?: string | null
}

const ALL_ROLES = ['owner', 'delegate', 'operator', 'deployer']

const ENGINE_ONBOARDING_MODE_ITEMS: Array<{ id: EngineOnboardingMode; label: string; description: string }> = [
  {
    id: 'manual_allowed',
    label: 'Manual and API registration',
    description: 'Admins can add engines in the UI and external systems can register engines through the API.',
  },
  {
    id: 'external_only',
    label: 'External registration only',
    description: 'Engine lifecycle is owned by external systems; manual create and delete actions are hidden and rejected.',
  },
  {
    id: 'hybrid',
    label: 'Hybrid ownership',
    description: 'Manual engines and externally registered engines can coexist with source-owned fields enforced per engine.',
  },
]

const PROJECT_ENGINE_TARGET_MODE_ITEMS: Array<{ id: ProjectEngineTargetPolicyMode; label: string; description: string }> = [
  {
    id: 'manual_allowed',
    label: 'Manual target management',
    description: 'Project owners and platform admins can manage local deployment targets; source-owned targets stay protected.',
  },
  {
    id: 'external_only',
    label: 'External targets only',
    description: 'Project-engine target relationships are managed by external systems; manual changes and legacy sync are blocked.',
  },
  {
    id: 'hybrid',
    label: 'Hybrid target ownership',
    description: 'Manual and externally managed targets can coexist with source ownership enforced per target.',
  },
]

const ACCESS_AUTHORITY_MODE_ITEMS: Array<{ id: AccessAuthorityMode; label: string; description: string }> = [
  {
    id: 'manual',
    label: 'Manual access',
    description: 'Manual platform assignments are the primary source of access; SSO grants can still be diagnosed separately.',
  },
  {
    id: 'transition_to_sso',
    label: 'Transition to SSO',
    description: 'Manual and SSO grants are shown together so admins can preview and remove duplicate manual assignments.',
  },
  {
    id: 'sso_managed',
    label: 'SSO-managed access',
    description: 'SSO-owned access is treated as source-owned in the UI; manual controls remain available only for manual rows.',
  },
]

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
  onEngineOnboardingModeChange,
  onProjectEngineTargetModeChange,
  onEngineAccessAuthorityChange,
  onProjectAccessAuthorityChange,
  onCredentiallessCustomerSidecarsEnabledChange,
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
  canManageSettings = true,
  settingsUnavailableReason,
  canReadGovernance = true,
  canManageGovernance = true,
  governanceReadUnavailableReason,
  governanceManageUnavailableReason,
}: EnginesSettingsSectionProps) {
  const deployRoles = Array.isArray(settings?.defaultDeployRoles) ? settings.defaultDeployRoles : []
  const selectedOnboardingMode = settings?.engineOnboardingMode || 'manual_allowed'
  const selectedProjectEngineTargetMode = settings?.projectEngineTargetMode || 'manual_allowed'
  const selectedEngineAccessAuthority = settings?.engineAccessAuthority || 'manual'
  const selectedProjectAccessAuthority = settings?.projectAccessAuthority || 'manual'
  const engineRuntimeAuthorizationMode = settings?.engineRuntimeAuthorizationMode || 'enterpriseglue_authoritative'
  const settingsDisabledReason = settingsUnavailableReason || 'Missing permission platform:settings:manage'
  const governanceAssignDisabledReason = governanceManageUnavailableReason || 'Missing permission platform:governance:manage'
  const canAssignGovernance = canReadGovernance && canManageGovernance

  return (
    <PlatformGrid style={{ paddingInline: 0, alignItems: 'stretch' }}>
      <PlatformRow>
        <PlatformCol sm={4} md={8} lg={16} style={{ marginInlineStart: 0, marginInlineEnd: 0 }}>
          <Tile style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-4)' }}>
              <Chip size={20} style={{ color: 'var(--color-text-secondary)' }} />
              <div>
                <h3 style={{ margin: '0 0 var(--spacing-1) 0', fontSize: '16px', fontWeight: 600 }}>Engine Onboarding</h3>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  Choose whether engines are created in the platform, registered externally, or both.
                </p>
              </div>
            </div>
            {!canManageSettings && (
              <InlineNotification
                kind="warning"
                title="Engine onboarding settings are read-only"
                subtitle={settingsDisabledReason}
                hideCloseButton
                lowContrast
                style={{ marginBottom: 'var(--spacing-4)' }}
              />
            )}
            <div style={{ display: 'grid', gap: 'var(--spacing-4)', maxWidth: 560 }}>
              <Dropdown
                id="engine-onboarding-mode"
                titleText="Onboarding mode"
                label="Select onboarding mode"
                items={ENGINE_ONBOARDING_MODE_ITEMS}
                itemToString={(item) => item?.label || ''}
                selectedItem={ENGINE_ONBOARDING_MODE_ITEMS.find((item) => item.id === selectedOnboardingMode)}
                onChange={({ selectedItem }) => {
                  if (selectedItem) onEngineOnboardingModeChange(selectedItem.id)
                }}
                helperText={ENGINE_ONBOARDING_MODE_ITEMS.find((item) => item.id === selectedOnboardingMode)?.description}
                size="md"
                disabled={!canManageSettings}
              />
              <Dropdown
                id="project-engine-target-mode"
                titleText="Project deployment target mode"
                label="Select target mode"
                items={PROJECT_ENGINE_TARGET_MODE_ITEMS}
                itemToString={(item) => item?.label || ''}
                selectedItem={PROJECT_ENGINE_TARGET_MODE_ITEMS.find((item) => item.id === selectedProjectEngineTargetMode)}
                onChange={({ selectedItem }) => {
                  if (selectedItem) onProjectEngineTargetModeChange(selectedItem.id)
                }}
                helperText={PROJECT_ENGINE_TARGET_MODE_ITEMS.find((item) => item.id === selectedProjectEngineTargetMode)?.description}
                size="md"
                disabled={!canManageSettings}
              />
              <Dropdown
                id="engine-access-authority"
                titleText="Engine access authority"
                label="Select access authority"
                items={ACCESS_AUTHORITY_MODE_ITEMS}
                itemToString={(item) => item?.label || ''}
                selectedItem={ACCESS_AUTHORITY_MODE_ITEMS.find((item) => item.id === selectedEngineAccessAuthority)}
                onChange={({ selectedItem }) => {
                  if (selectedItem) onEngineAccessAuthorityChange(selectedItem.id)
                }}
                helperText={ACCESS_AUTHORITY_MODE_ITEMS.find((item) => item.id === selectedEngineAccessAuthority)?.description}
                size="md"
                disabled={!canManageSettings}
              />
              <Dropdown
                id="project-access-authority"
                titleText="Project access authority"
                label="Select access authority"
                items={ACCESS_AUTHORITY_MODE_ITEMS}
                itemToString={(item) => item?.label || ''}
                selectedItem={ACCESS_AUTHORITY_MODE_ITEMS.find((item) => item.id === selectedProjectAccessAuthority)}
                onChange={({ selectedItem }) => {
                  if (selectedItem) onProjectAccessAuthorityChange(selectedItem.id)
                }}
                helperText={ACCESS_AUTHORITY_MODE_ITEMS.find((item) => item.id === selectedProjectAccessAuthority)?.description}
                size="md"
                disabled={!canManageSettings}
              />
              <div aria-label="Runtime authorization mode" style={{ display: 'grid', gap: 'var(--spacing-2)', paddingTop: 'var(--spacing-2)' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Runtime authorization</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
                  <Tag type="blue">EnterpriseGlue authoritative</Tag>
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
                    {engineRuntimeAuthorizationMode === 'enterpriseglue_authoritative'
                      ? 'EnterpriseGlue is the v1 authorization source for runtime resources.'
                      : 'Unsupported runtime authorization mode.'}
                  </span>
                </div>
              </div>
              <Checkbox
                id="credentialless-customer-sidecars-enabled"
                labelText="Allow credentialless customer-sidecar endpoints"
                checked={settings?.credentiallessCustomerSidecarsEnabled === true}
                onChange={(_event, { checked }) => onCredentiallessCustomerSidecarsEnabledChange(Boolean(checked))}
                disabled={!canManageSettings}
                title={!canManageSettings ? settingsDisabledReason : undefined}
              />
              <p style={{ margin: '-0.5rem 0 0 1.75rem', color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
                Applies only to customer-managed sidecars or gateways. EnterpriseGlue remains authoritative for runtime authorization.
              </p>
            </div>
          </Tile>
        </PlatformCol>
      </PlatformRow>
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

            {!canReadGovernance && (
              <InlineNotification
                kind="error"
                title="Engine governance unavailable"
                subtitle={governanceReadUnavailableReason || 'Missing permission platform:governance:read'}
                hideCloseButton
                lowContrast
              />
            )}

            {canReadGovernance && !canManageGovernance && (
              <InlineNotification
                kind="warning"
                title="Engine governance is read-only"
                subtitle={governanceAssignDisabledReason}
                hideCloseButton
                lowContrast
                style={{ marginBottom: 'var(--spacing-4)' }}
              />
            )}

            {canReadGovernance && (
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
                  disabled={!selectedEngine || !canAssignGovernance}
                  title={!canAssignGovernance ? governanceAssignDisabledReason : undefined}
                  onClick={() => selectedEngine && onAssignOwner({ id: selectedEngine.id, name: selectedEngine.name })}
                >
                  Assign Owner
                </Button>
                <Button
                  kind="tertiary"
                  size="md"
                  disabled={!selectedEngine || !canAssignGovernance}
                  title={!canAssignGovernance ? governanceAssignDisabledReason : undefined}
                  onClick={() => selectedEngine && onAssignDelegate({ id: selectedEngine.id, name: selectedEngine.name })}
                >
                  Assign Delegate
                </Button>
              </div>
            </div>
            )}

            {canReadGovernance && selectedEngine && (
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
            {!canManageSettings && (
              <InlineNotification
                kind="warning"
                title="Default deploy permissions are read-only"
                subtitle={settingsDisabledReason}
                hideCloseButton
                lowContrast
                style={{ marginBottom: 'var(--spacing-4)' }}
              />
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)' }}>
              {ALL_ROLES.map((role) => {
                const isChecked = deployRoles.includes(role)
                return (
                  <Checkbox
                    key={role}
                    id={`deploy-role-${role}`}
                    labelText={role.charAt(0).toUpperCase() + role.slice(1)}
                    checked={isChecked}
                    onChange={(_, { checked }) => {
                      if (canManageSettings) onDeployRoleToggle(role, checked)
                    }}
                    disabled={!canManageSettings}
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
              <Button
                kind="tertiary"
                size="sm"
                renderIcon={Add}
                disabled={!canManageSettings}
                title={!canManageSettings ? settingsDisabledReason : undefined}
                onClick={onOpenCreateModal}
              >
                Add
              </Button>
            </div>
            {!canManageSettings && (
              <InlineNotification
                kind="warning"
                title="Engine environments are read-only"
                subtitle={settingsDisabledReason}
                hideCloseButton
                lowContrast
                style={{ marginBottom: 'var(--spacing-4)' }}
              />
            )}

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
                    draggable={canManageSettings}
                    onDragStart={(e) => {
                      if (canManageSettings) onDragStart(e, tag.id)
                    }}
                    onDragOver={(e) => {
                      if (canManageSettings) onDragOver(e, tag.id)
                    }}
                    onDragLeave={() => {
                      if (canManageSettings) onDragLeave()
                    }}
                    onDrop={(e) => {
                      if (canManageSettings) onDrop(e, tag.id)
                    }}
                    onDragEnd={() => {
                      if (canManageSettings) onDragEnd()
                    }}
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
                      cursor: canManageSettings ? 'grab' : 'default',
                      opacity: draggedTagId === tag.id ? 0.5 : 1,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <Draggable size={16} style={{ color: 'var(--color-text-secondary)', flexShrink: 0, cursor: canManageSettings ? 'grab' : 'default' }} />
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontWeight: 500, fontSize: '14px' }}>{tag.name}</span>
                    <Tag type={tag.manualDeployAllowed ? 'green' : 'red'} size="sm">
                      {tag.manualDeployAllowed ? 'Manual OK' : 'CI/CD Only'}
                    </Tag>
                    <Button
                      kind="ghost"
                      size="sm"
                      hasIconOnly
                      renderIcon={Edit}
                      iconDescription="Edit"
                      disabled={!canManageSettings}
                      title={!canManageSettings ? settingsDisabledReason : undefined}
                      onClick={() => onOpenEditModal(tag)}
                    />
                    <Button
                      kind="ghost"
                      size="sm"
                      hasIconOnly
                      renderIcon={TrashCan}
                      iconDescription="Delete"
                      disabled={!canManageSettings}
                      title={!canManageSettings ? settingsDisabledReason : undefined}
                      onClick={() => onDeleteTag(tag)}
                    />
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
