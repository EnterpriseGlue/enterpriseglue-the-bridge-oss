import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Checkbox,
  ComposedModal,
  Dropdown,
  InlineLoading,
  InlineNotification,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react'
import { TrashCan, Renew } from '@carbon/icons-react'
import { apiClient } from '../../../../shared/api/client'
import { fetchList } from '../../../../shared/api/fetchList';
import { parseApiError } from '../../../../shared/api/apiErrorUtils'
import { PlatformPermission, ProjectPermission } from '../../../../shared/auth/permissions'
import { WhyUnavailableLink } from '../../../../shared/auth/guards'
import type { ProjectEngineTargetPolicyMode } from '../../../../api/platform-admin'
import type { UiAuthzDecision } from '@enterpriseglue/shared/authz/permission-actions.js'
import type {
  AuthzCreatedIdResponse,
  AuthzMutationSuccessResponse,
  ProjectEngineTarget,
  ProjectEngineTargetApprovalStatus,
  ProjectEngineTargetCreate,
  ProjectEngineTargetSource,
  ProjectEngineTargetStatus,
  ProjectEngineTargetSyncLegacyResponse,
  ProjectEngineTargetUpdate,
} from '../../../platform-admin/hooks/useAuthzApi'

type EngineOption = {
  id: string
  name?: string | null
  baseUrl?: string | null
}

type TargetModeFlags = {
  allowManualDeploy: boolean
  allowCiDeploy: boolean
  allowApiDeploy: boolean
  allowImport: boolean
}

interface ProjectDeploymentTargetsModalProps {
  projectId: string
  open: boolean
  onClose: () => void
  apiScope?: 'platform' | 'project'
  projectEngineTargetMode?: ProjectEngineTargetPolicyMode
  engines?: EngineOption[]
  enginesLoading?: boolean
  canReadTargets: boolean
  canManageTargets: boolean
  readTargetsUnavailableReason?: string | null
  manageTargetsUnavailableReason?: string | null
}

const DEFAULT_CREATE_FLAGS: TargetModeFlags = {
  allowManualDeploy: true,
  allowCiDeploy: false,
  allowApiDeploy: false,
  allowImport: true,
}

const statusItems: Array<{ id: ProjectEngineTargetStatus; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'disabled', label: 'Disabled' },
]

const sourceOwnedTargetSources = new Set<ProjectEngineTargetSource>(['ci', 'api', 'external', 'system', 'automation', 'config'])

function buildDeploymentTargetDiagnosticDecision(
  projectId: string,
  apiScope: 'platform' | 'project',
  operation: 'read' | 'manage',
  reason: string | null
): UiAuthzDecision | null {
  if (!reason) return null

  const projectScoped = apiScope === 'project'
  const manage = operation === 'manage'
  return {
    actionId: projectScoped
      ? (manage ? 'project.deployment-targets.manage' : 'project.deployment-targets.read')
      : (manage ? 'platform.project-engine-targets.manage' : 'platform.project-engine-targets.read'),
    allowed: false,
    diagnostics: {
      explainUrl: '/admin/access-control?tab=effective-access',
      remediation: ['Ask a platform administrator to review effective access.'],
    },
    permissionId: projectScoped
      ? (manage ? ProjectPermission.DEPLOYMENT_TARGETS_MANAGE : ProjectPermission.DEPLOYMENT_TARGETS_VIEW)
      : (manage ? PlatformPermission.PROJECT_ENGINE_TARGETS_MANAGE : PlatformPermission.PROJECT_ENGINE_TARGETS_VIEW),
    reason,
    resourceId: projectScoped ? projectId : null,
    resourceType: projectScoped ? 'project' : 'platform',
    state: 'disabled',
  }
}

export function ProjectDeploymentTargetsModal({
  projectId,
  open,
  onClose,
  apiScope = 'platform',
  projectEngineTargetMode = 'manual_allowed',
  engines = [],
  enginesLoading = false,
  canReadTargets,
  canManageTargets,
  readTargetsUnavailableReason,
  manageTargetsUnavailableReason,
}: ProjectDeploymentTargetsModalProps) {
  const queryClient = useQueryClient()
  const [selectedEngineId, setSelectedEngineId] = React.useState('')
  const [createFlags, setCreateFlags] = React.useState<TargetModeFlags>(DEFAULT_CREATE_FLAGS)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setSelectedEngineId('')
    setCreateFlags(DEFAULT_CREATE_FLAGS)
    setError(null)
  }, [open])

  const readReason = canReadTargets
    ? null
    : readTargetsUnavailableReason || `Missing permission ${PlatformPermission.PROJECT_ENGINE_TARGETS_VIEW}`
  const policyManageReason = projectEngineTargetMode === 'external_only'
    ? 'Project deployment targets are externally managed by platform policy'
    : null
  const manageReason = !canManageTargets
    ? manageTargetsUnavailableReason || `Missing permission ${PlatformPermission.PROJECT_ENGINE_TARGETS_MANAGE}`
    : policyManageReason
  const createOrSyncReason = manageReason
  const firstAuthzDiagnosticDecision =
    buildDeploymentTargetDiagnosticDecision(projectId, apiScope, 'read', readReason) ||
    buildDeploymentTargetDiagnosticDecision(projectId, apiScope, 'manage', manageReason)
  const isProjectScopedApi = apiScope === 'project'
  const projectScopedBasePath = `/starbase-api/projects/${encodeURIComponent(projectId)}/deployment-targets`
  const listTargetsPath = isProjectScopedApi
    ? `${projectScopedBasePath}?status=all`
    : `/api/authz/project-engine-targets?projectId=${encodeURIComponent(projectId)}&status=all`
  const createTargetPath = isProjectScopedApi
    ? projectScopedBasePath
    : '/api/authz/project-engine-targets'
  const syncLegacyPath = isProjectScopedApi
    ? `${projectScopedBasePath}/sync-legacy`
    : '/api/authz/project-engine-targets/sync-legacy'
  const targetPath = React.useCallback((id: string) => (
    isProjectScopedApi
      ? `${projectScopedBasePath}/${encodeURIComponent(id)}`
      : `/api/authz/project-engine-targets/${encodeURIComponent(id)}`
  ), [isProjectScopedApi, projectScopedBasePath])

  const targetsQ = useQuery({
    queryKey: ['project-engine-targets', projectId, 'settings', apiScope],
    queryFn: () => fetchList<ProjectEngineTarget>(listTargetsPath),
    enabled: open && Boolean(projectId) && canReadTargets,
  })

  const invalidateTargets = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project-engine-targets', projectId, 'settings'] }),
      queryClient.invalidateQueries({ queryKey: ['project-engine-access', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'authz', 'project-engine-targets'] }),
    ])
  }, [projectId, queryClient])

  const createTargetM = useMutation({
    mutationFn: (payload: { engineId: string } & TargetModeFlags) => {
      const target: ProjectEngineTargetCreate = {
        projectId,
        engineId: payload.engineId,
        status: 'active',
        source: 'manual',
        allowManualDeploy: payload.allowManualDeploy,
        allowCiDeploy: payload.allowCiDeploy,
        allowApiDeploy: payload.allowApiDeploy,
        allowImport: payload.allowImport,
      }
      if (isProjectScopedApi) {
        const { projectId: _projectId, source: _source, ...projectTarget } = target
        return apiClient.post<AuthzCreatedIdResponse>(createTargetPath, projectTarget)
      }
      return apiClient.post<AuthzCreatedIdResponse>(createTargetPath, target)
    },
    onSuccess: async () => {
      setSelectedEngineId('')
      setCreateFlags(DEFAULT_CREATE_FLAGS)
      setError(null)
      await invalidateTargets()
    },
    onError: (err: unknown) => setError(parseApiError(err, 'Failed to create deployment target').message),
  })

  const updateTargetM = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Partial<TargetModeFlags> & { status?: ProjectEngineTargetStatus }) => {
      const target: Omit<ProjectEngineTargetUpdate, 'id'> = payload
      return apiClient.put<AuthzMutationSuccessResponse>(targetPath(id), target)
    },
    onSuccess: async () => {
      setError(null)
      await invalidateTargets()
    },
    onError: (err: unknown) => setError(parseApiError(err, 'Failed to update deployment target').message),
  })

  const archiveTargetM = useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(targetPath(id)),
    onSuccess: async () => {
      setError(null)
      await invalidateTargets()
    },
    onError: (err: unknown) => setError(parseApiError(err, 'Failed to archive deployment target').message),
  })

  const syncLegacyM = useMutation({
    mutationFn: () => apiClient.post<ProjectEngineTargetSyncLegacyResponse>(syncLegacyPath, isProjectScopedApi ? {} : { projectId }),
    onSuccess: async () => {
      setError(null)
      await invalidateTargets()
    },
    onError: (err: unknown) => setError(parseApiError(err, 'Failed to sync legacy engine access').message),
  })

  if (!open) return null

  const targets = targetsQ.data || []
  const existingEngineIds = new Set(targets.filter((target) => target.status !== 'archived').map((target) => target.engineId))
  const selectableEngines = engines.filter((engine) => !existingEngineIds.has(String(engine.id)))
  const selectedEngine = selectableEngines.find((engine) => String(engine.id) === selectedEngineId) || null
  const isMutating = createTargetM.isPending || updateTargetM.isPending || archiveTargetM.isPending || syncLegacyM.isPending

  return (
    <ComposedModal open size="lg" onClose={onClose}>
      <ModalHeader label="Project settings" title="Deployment targets" closeModal={onClose} />
      <ModalBody>
        <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
          {error && (
            <InlineNotification lowContrast kind="error" title="Deployment target update failed" subtitle={error} hideCloseButton />
          )}
          {readReason && (
            <InlineNotification lowContrast kind="warning" title="Deployment targets unavailable" subtitle={readReason} hideCloseButton />
          )}
          {!readReason && manageReason && (
            <InlineNotification
              lowContrast
              kind="info"
              title={policyManageReason ? 'Manual deployment target changes unavailable' : 'Deployment target changes unavailable'}
              subtitle={manageReason}
              hideCloseButton
            />
          )}
          {firstAuthzDiagnosticDecision ? (
            <div style={{ fontSize: 12 }}>
              <WhyUnavailableLink decision={firstAuthzDiagnosticDecision} />
            </div>
          ) : null}

          {!readReason && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, color: 'var(--cds-text-secondary)' }}>
                  Manage which engines this project can use for manual, CI, API, and import flows.
                </div>
                <Button
                  size="sm"
                  kind="tertiary"
                  renderIcon={Renew}
                  disabled={Boolean(createOrSyncReason) || isMutating}
                  title={createOrSyncReason ?? undefined}
                  onClick={() => {
                    if (!createOrSyncReason) syncLegacyM.mutate()
                  }}
                >
                  {syncLegacyM.isPending ? 'Syncing...' : 'Sync legacy access'}
                </Button>
              </div>

              {targetsQ.isLoading ? (
                <InlineLoading description="Loading deployment targets..." />
              ) : targetsQ.isError ? (
                <InlineNotification lowContrast kind="error" title="Failed to load deployment targets" subtitle={parseApiError(targetsQ.error, 'Failed to load deployment targets').message} hideCloseButton />
              ) : targets.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--cds-text-secondary)' }}>No deployment targets are configured for this project.</p>
              ) : (
                <Table size="sm">
                  <TableHead>
                    <TableRow>
                      <TableHeader>Engine</TableHeader>
                      <TableHeader>Status</TableHeader>
                      <TableHeader>Source</TableHeader>
                      <TableHeader>Modes</TableHeader>
                      <TableHeader>Updated</TableHeader>
                      <TableHeader>Actions</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {targets.map((target) => {
                      const sourceOwned = isSourceOwnedTarget(target)
                      const targetManageReason = manageReason || (sourceOwned ? sourceOwnedTargetReason(target) : null)
                      return (
                        <TableRow key={target.id}>
                          <TableCell>
                            <div style={{ fontWeight: 500 }}>{target.engineName || target.engineBaseUrl || target.engineId}</div>
                            <div style={{ fontSize: 12, color: 'var(--cds-text-secondary)', overflowWrap: 'anywhere' }}>{target.engineId}</div>
                          </TableCell>
                          <TableCell>
                            <Select
                              id={`target-status-${target.id}`}
                              labelText=""
                              hideLabel
                              size="sm"
                              value={target.status === 'archived' ? 'disabled' : target.status}
                              disabled={Boolean(targetManageReason) || isMutating || target.status === 'archived'}
                              title={targetManageReason ?? undefined}
                              onChange={(event) => {
                                if (!targetManageReason) updateTargetM.mutate({ id: target.id, status: event.target.value as ProjectEngineTargetStatus })
                              }}
                            >
                              {statusItems.map((status) => (
                                <SelectItem key={status.id} value={status.id} text={status.label} />
                              ))}
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div style={{ display: 'grid', gap: 'var(--spacing-1)' }}>
                              <Tag size="sm" type={target.source === 'manual' ? 'blue' : sourceOwned ? 'purple' : 'gray'}>{formatLabel(target.source)}</Tag>
                              <Tag size="sm" type={approvalStatusTagType(target.approvalStatus || 'not_required')}>{formatLabel(target.approvalStatus || 'not_required')}</Tag>
                              {(target.policyTags || []).map((tag) => (
                                <Tag key={tag} size="sm" type="teal">{tag}</Tag>
                              ))}
                              {sourceOwned ? (
                                <div style={{ fontSize: 12, color: 'var(--cds-text-secondary)' }}>
                                  Source-owned{target.sourceRef ? `: ${target.sourceRef}` : ''}
                                </div>
                              ) : null}
                              {targetMetadataLines(target).map((line) => (
                                <div key={line} style={{ fontSize: 12, color: 'var(--cds-text-secondary)', overflowWrap: 'anywhere' }}>
                                  {line}
                                </div>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <ModeFlagsEditor
                              target={target}
                              disabled={Boolean(targetManageReason) || isMutating || target.status === 'archived'}
                              disabledReason={targetManageReason}
                              onChange={(flag, value) => {
                                if (!targetManageReason) updateTargetM.mutate({ id: target.id, [flag]: value })
                              }}
                            />
                          </TableCell>
                          <TableCell>{formatTimestamp(target.updatedAt)}</TableCell>
                          <TableCell>
                            <Button
                              hasIconOnly
                              kind="ghost"
                              size="sm"
                              renderIcon={TrashCan}
                              iconDescription="Archive target"
                              disabled={Boolean(targetManageReason) || isMutating || target.status === 'archived'}
                              title={targetManageReason ?? undefined}
                              onClick={() => {
                                if (!targetManageReason) archiveTargetM.mutate(target.id)
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}

              <section style={{ borderTop: '1px solid var(--cds-border-subtle)', paddingTop: 'var(--spacing-4)', display: 'grid', gap: 'var(--spacing-3)' }}>
                <h5 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Add deployment target</h5>
                {enginesLoading ? (
                  <InlineLoading description="Loading engines..." />
                ) : (
                  <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
                    <Dropdown
                      id="deployment-target-engine"
                      titleText="Engine"
                      label={selectableEngines.length > 0 ? 'Select an engine' : 'No engines available'}
                      items={selectableEngines}
                      itemToString={(item: EngineOption | null) => item ? formatEngineOption(item) : ''}
                      selectedItem={selectedEngine}
                      disabled={Boolean(createOrSyncReason) || isMutating || selectableEngines.length === 0}
                      onChange={({ selectedItem }: { selectedItem?: EngineOption | null }) => setSelectedEngineId(selectedItem?.id || '')}
                    />
                    <CreateModeFlags flags={createFlags} disabled={Boolean(createOrSyncReason) || isMutating} onChange={(flag, value) => setCreateFlags((current) => ({ ...current, [flag]: value }))} />
                    <Button
                      size="sm"
                      disabled={Boolean(createOrSyncReason) || isMutating || !selectedEngineId}
                      title={createOrSyncReason ?? undefined}
                      onClick={() => {
                        if (!selectedEngineId || createOrSyncReason) return
                        createTargetM.mutate({ engineId: selectedEngineId, ...createFlags })
                      }}
                    >
                      {createTargetM.isPending ? 'Adding...' : 'Add target'}
                    </Button>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button kind="secondary" onClick={onClose}>Close</Button>
      </ModalFooter>
    </ComposedModal>
  )
}

function ModeFlagsEditor({
  target,
  disabled,
  disabledReason,
  onChange,
}: {
  target: TargetModeFlags
  disabled: boolean
  disabledReason?: string | null
  onChange: (flag: keyof TargetModeFlags, value: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)' }} title={disabledReason ?? undefined}>
      <ModeCheckbox idSuffix="manual" label="Manual" checked={target.allowManualDeploy} disabled={disabled} onChange={(checked) => onChange('allowManualDeploy', checked)} />
      <ModeCheckbox idSuffix="ci" label="CI" checked={target.allowCiDeploy} disabled={disabled} onChange={(checked) => onChange('allowCiDeploy', checked)} />
      <ModeCheckbox idSuffix="api" label="API" checked={target.allowApiDeploy} disabled={disabled} onChange={(checked) => onChange('allowApiDeploy', checked)} />
      <ModeCheckbox idSuffix="import" label="Import" checked={target.allowImport} disabled={disabled} onChange={(checked) => onChange('allowImport', checked)} />
    </div>
  )
}

function CreateModeFlags({
  flags,
  disabled,
  onChange,
}: {
  flags: TargetModeFlags
  disabled: boolean
  onChange: (flag: keyof TargetModeFlags, value: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-3)' }}>
      <ModeCheckbox idSuffix="create-manual" label="Manual" checked={flags.allowManualDeploy} disabled={disabled} onChange={(checked) => onChange('allowManualDeploy', checked)} />
      <ModeCheckbox idSuffix="create-ci" label="CI" checked={flags.allowCiDeploy} disabled={disabled} onChange={(checked) => onChange('allowCiDeploy', checked)} />
      <ModeCheckbox idSuffix="create-api" label="API" checked={flags.allowApiDeploy} disabled={disabled} onChange={(checked) => onChange('allowApiDeploy', checked)} />
      <ModeCheckbox idSuffix="create-import" label="Import" checked={flags.allowImport} disabled={disabled} onChange={(checked) => onChange('allowImport', checked)} />
    </div>
  )
}

function ModeCheckbox({
  idSuffix,
  label,
  checked,
  disabled,
  onChange,
}: {
  idSuffix: string
  label: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  const id = React.useId()
  return (
    <Checkbox
      id={`target-mode-${id}-${idSuffix}`}
      labelText={label}
      checked={checked}
      disabled={disabled}
      onChange={(_, data) => onChange(Boolean(data.checked))}
    />
  )
}

function formatEngineOption(engine: EngineOption): string {
  return engine.name || engine.baseUrl || engine.id
}

function formatLabel(value: string): string {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function isSourceOwnedTarget(target: ProjectEngineTarget): boolean {
  return sourceOwnedTargetSources.has(target.source) && !(target.source === 'config' && target.ownershipMode === 'config_warn')
}

function sourceOwnedTargetReason(target: ProjectEngineTarget): string {
  const owner = formatLabel(target.source).toLowerCase()
  return `Managed by ${owner}${target.sourceRef ? ` (${target.sourceRef})` : ''}`
}

function approvalStatusTagType(status: ProjectEngineTargetApprovalStatus): 'green' | 'red' | 'cyan' | 'gray' {
  if (status === 'approved') return 'green'
  if (status === 'rejected') return 'red'
  if (status === 'pending') return 'cyan'
  return 'gray'
}

function formatDiagnosticValue(value: unknown): string {
  if (value === null || typeof value === 'undefined') return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(formatDiagnosticValue).filter(Boolean).join(', ')
  return JSON.stringify(value)
}

function targetMetadataLines(target: ProjectEngineTarget): string[] {
  const lines: string[] = []
  if (target.externalSystemId) lines.push(`External system: ${target.externalSystemId}`)
  if (target.externalProjectId) lines.push(`External project: ${target.externalProjectId}`)
  if (target.externalEngineId) lines.push(`External engine: ${target.externalEngineId}`)
  if (target.externalTargetId) lines.push(`External target: ${target.externalTargetId}`)
  if (target.approvedAt) lines.push(`Approved: ${formatTimestamp(target.approvedAt)}`)

  const diagnostics = Object.entries(target.diagnostics || {})
    .map(([key, value]) => [formatLabel(key), formatDiagnosticValue(value)] as const)
    .filter(([, value]) => Boolean(value))
    .slice(0, 3)
  for (const [key, value] of diagnostics) {
    lines.push(`${key}: ${value}`)
  }
  return lines
}

function formatTimestamp(value: number | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '-'
}
