import React from 'react'
import {
  Button,
  Dropdown,
  InlineLoading,
  InlineNotification,
  Tag,
  TextInput,
  Toggle,
} from '@carbon/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AccessibleEngineSummary,
  EngineTenancyConfiguration,
  EngineTenancyDiagnostics,
  EngineTenancyTopologyState,
  EngineTenancyTransitionAcknowledgement,
  EngineTenancyTransitionPreviewResponse,
  EngineTenantMapping,
  EngineTenantMappingStrategy,
  ExternalEngineTenantMappingsUpsertRequest,
  ExternalEngineTenantMappingsUpsertResponse,
} from '@enterpriseglue/shared/schemas/mission-control/engine.js'
import { getUiErrorMessage } from '../../../../shared/api/apiErrorUtils'
import { useToast } from '../../../../shared/notifications/ToastProvider'
import {
  applyEngineTenancyTransition,
  getEngineTenancyDiagnostics,
  getEngineTenantMappings,
  previewEngineTenancyTransition,
  upsertEngineTenantMappings,
} from '../api/engines'

const MAPPING_STRATEGIES: Array<{ id: EngineTenantMappingStrategy; label: string; description: string }> = [
  {
    id: 'engine_tenant_id',
    label: 'Use the engine tenant ID',
    description: 'Match the tenant identifier reported by the engine to an EnterpriseGlue tenant.',
  },
  {
    id: 'deployment_target',
    label: 'Use the project deployment target',
    description: 'Resolve the tenant from the EnterpriseGlue project and deployment target that produced the runtime resource.',
  },
  {
    id: 'explicit',
    label: 'Maintain explicit tenant mappings',
    description: 'An operator maps each external engine tenant identifier to a specific EnterpriseGlue tenant.',
  },
]

const TOPOLOGY_OPTIONS: Array<{ id: 'dedicated' | 'shared'; label: string; description: string }> = [
  {
    id: 'dedicated',
    label: 'One tenant — this tenant',
    description: 'The engine belongs only to the tenant you are currently administering. No tenant mapping is needed.',
  },
  {
    id: 'shared',
    label: 'Multiple tenants — map each runtime resource',
    description: 'The engine is shared. Every runtime resource must resolve to exactly one tenant before it becomes visible.',
  },
]

function optionElement(item: { label: string; description: string }) {
  return (
    <div style={{ display: 'grid', gap: 2, paddingBlock: 2, whiteSpace: 'normal' }}>
      <span style={{ fontWeight: 500 }}>{item.label}</span>
      <span style={{ color: 'var(--cds-text-secondary)', fontSize: 12, lineHeight: 1.35 }}>{item.description}</span>
    </div>
  )
}

const ACKNOWLEDGEMENT_LABELS: Record<EngineTenancyTransitionAcknowledgement, string> = {
  acknowledge_topology_change: 'I reviewed the topology change.',
  acknowledge_mapping_deactivation: 'I reviewed the mappings that will be deactivated.',
  acknowledge_resource_quarantine: 'I accept that unresolved runtime resources will be quarantined.',
  acknowledge_access_change: 'I reviewed the resulting access changes.',
}

type MappingTenantTarget = 'request_context' | 'default' | 'key' | 'existing'

export interface EngineTenantMappingFormState {
  externalTenantId: string
  sourceRef: string
  target: MappingTenantTarget
  tenantKey: string
  existingTenantId: string
  active: boolean
}

const EMPTY_MAPPING_FORM: EngineTenantMappingFormState = {
  externalTenantId: '',
  sourceRef: '',
  target: 'request_context',
  tenantKey: '',
  existingTenantId: '',
  active: true,
}

export function buildEngineTenancyConfiguration(
  mode: 'dedicated' | 'shared',
  mappingStrategy: EngineTenantMappingStrategy,
): EngineTenancyConfiguration {
  return mode === 'shared'
    ? { mode: 'shared', mappingStrategy, unmappedPolicy: 'deny' }
    : { mode: 'dedicated', tenantRef: { type: 'request_context' } }
}

export function hasEngineTenancyTransition(
  current: Pick<EngineTenancyTopologyState, 'mode' | 'mappingStrategy'>,
  proposed: EngineTenancyConfiguration,
): boolean {
  return current.mode !== proposed.mode
    || (current.mode === 'shared' && proposed.mode === 'shared' && current.mappingStrategy !== proposed.mappingStrategy)
}

export function buildEngineTenantMappingRequest(
  form: EngineTenantMappingFormState,
  strategy: EngineTenantMappingStrategy,
  expectedMappingVersion: number,
  dryRun: boolean,
): ExternalEngineTenantMappingsUpsertRequest {
  const tenantRef = form.target === 'default'
    ? { type: 'default' as const }
    : form.target === 'key'
      ? { type: 'key' as const, key: form.tenantKey.trim() }
      : form.target === 'existing'
        ? { type: 'id' as const, id: form.existingTenantId }
        : { type: 'request_context' as const }
  const externalTenantId = form.externalTenantId.trim()
  return {
    expectedMappingVersion,
    dryRun,
    atomic: true,
    mappings: [{
      externalTenantId,
      tenantRef,
      strategy,
      sourceRef: form.sourceRef.trim() || `manual:${externalTenantId || 'mapping'}`,
      active: form.active,
    }],
  }
}

function formatStatus(value: string | null | undefined): string {
  if (!value) return '-'
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function statusTagType(status: string | null | undefined): 'green' | 'red' | 'magenta' | 'gray' {
  if (status === 'ready' || status === 'resolved') return 'green'
  if (status === 'conflict') return 'red'
  if (status === 'incomplete' || status === 'migration_required') return 'magenta'
  return 'gray'
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 14, color: 'var(--color-text-primary)', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )
}

function Metrics({
  diagnostics,
  loading,
  error,
}: {
  diagnostics?: EngineTenancyDiagnostics
  loading: boolean
  error: unknown
}) {
  if (loading) return <InlineLoading description="Loading tenancy diagnostics" />
  if (error) {
    return (
      <InlineNotification
        lowContrast
        hideCloseButton
        kind="error"
        title="Tenancy diagnostics unavailable"
        subtitle={getUiErrorMessage(error, 'Failed to load tenancy diagnostics')}
      />
    )
  }
  if (!diagnostics) return null
  return (
    <div
      aria-label="Tenancy diagnostics"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        gap: 'var(--spacing-3)',
      }}
    >
      <Detail label="Topology" value={formatStatus(diagnostics.mode)} />
      <Detail label="Owning tenant" value={diagnostics.tenantId || (diagnostics.mode === 'shared' ? 'Per runtime resource' : '-')} />
      <Detail label="Mapping strategy" value={formatStatus(diagnostics.mappingStrategy)} />
      <Detail label="Mapping version" value={String(diagnostics.mappingVersion)} />
      <Detail
        label="Resolution"
        value={<Tag size="sm" type={statusTagType(diagnostics.resolutionStatus)}>{formatStatus(diagnostics.resolutionStatus)}</Tag>}
      />
      <Detail label="Mapped resources" value={String(diagnostics.mappedResourceCount)} />
      <Detail label="Unmapped resources" value={String(diagnostics.unmappedResourceCount)} />
      <Detail label="Conflicting resources" value={String(diagnostics.conflictingResourceCount)} />
      <Detail
        label="Last reconciled"
        value={diagnostics.lastReconciledAt ? new Date(diagnostics.lastReconciledAt).toISOString() : 'Not reconciled'}
      />
    </div>
  )
}

function TransitionEffects({ preview }: { preview: EngineTenancyTransitionPreviewResponse }) {
  const effects = preview.effects
  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
      <InlineNotification
        lowContrast
        hideCloseButton
        kind="warning"
        title={`Review ${formatStatus(preview.kind)}`}
        subtitle={`This preview expires at ${new Date(preview.previewExpiresAt).toISOString()}. Apply requires this exact preview and every acknowledgement below.`}
      />
      <div
        aria-label="Topology transition effects"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
          gap: 'var(--spacing-3)',
        }}
      >
        <Detail label="Assignments" value={String(effects.roleAssignments)} />
        <Detail label="Tenant mappings" value={String(effects.tenantMappings)} />
        <Detail label="Runtime resources" value={String(effects.runtimeResources)} />
        <Detail label="Engine Set memberships" value={String(effects.engineSetMemberships)} />
        <Detail label="Deployment targets" value={String(effects.deploymentTargets)} />
        <Detail label="Deployment receipts" value={String(effects.deploymentReceipts)} />
        <Detail label="Become visible" value={String(effects.visibility.becomeVisible)} />
        <Detail label="Become hidden" value={String(effects.visibility.becomeHidden)} />
        <Detail label="Become unmapped" value={String(effects.visibility.becomeUnmapped)} />
        <Detail label="Become conflicting" value={String(effects.visibility.becomeConflicting)} />
      </div>
    </div>
  )
}

function mappingFormFromRow(mapping: EngineTenantMapping): EngineTenantMappingFormState {
  return {
    externalTenantId: mapping.externalTenantId,
    sourceRef: mapping.sourceRef,
    target: 'existing',
    tenantKey: '',
    existingTenantId: mapping.enterpriseTenantId,
    active: mapping.isActive,
  }
}

export interface EngineTenancyPanelProps {
  engine: Pick<
    AccessibleEngineSummary,
    | 'id'
    | 'name'
    | 'tenancyMode'
    | 'tenantId'
    | 'tenantMappingStrategy'
    | 'tenantMappingVersion'
    | 'tenantResolutionStatus'
    | 'runtimeAccessScope'
  >
  canManage: boolean
  managementReason?: string | null
}

export default function EngineTenancyPanel({
  engine,
  canManage,
  managementReason,
}: EngineTenancyPanelProps) {
  const queryClient = useQueryClient()
  const { notify } = useToast()
  const initialState = React.useMemo<EngineTenancyTopologyState>(() => ({
    mode: engine.tenancyMode === 'shared' ? 'shared' : 'dedicated',
    tenantId: engine.tenantId || null,
    mappingStrategy: engine.tenancyMode === 'shared'
      ? engine.tenantMappingStrategy || 'explicit'
      : null,
    mappingVersion: engine.tenantMappingVersion || 0,
    resolutionStatus: engine.tenantResolutionStatus || (engine.tenantId ? 'ready' : 'migration_required'),
    runtimeAccessScope: engine.runtimeAccessScope === 'resource_aware' ? 'resource_aware' : 'engine_wide',
  }), [
    engine.runtimeAccessScope,
    engine.tenantId,
    engine.tenantMappingStrategy,
    engine.tenantMappingVersion,
    engine.tenantResolutionStatus,
    engine.tenancyMode,
  ])
  const [current, setCurrent] = React.useState(initialState)
  const [proposedMode, setProposedMode] = React.useState<'dedicated' | 'shared'>(initialState.mode)
  const [proposedStrategy, setProposedStrategy] = React.useState<EngineTenantMappingStrategy>(
    initialState.mappingStrategy || 'engine_tenant_id',
  )
  const [preview, setPreview] = React.useState<EngineTenancyTransitionPreviewResponse | null>(null)
  const [acknowledgements, setAcknowledgements] = React.useState<Set<EngineTenancyTransitionAcknowledgement>>(new Set())
  const [mappingForm, setMappingForm] = React.useState<EngineTenantMappingFormState>(EMPTY_MAPPING_FORM)
  const [mappingPreview, setMappingPreview] = React.useState<ExternalEngineTenantMappingsUpsertResponse | null>(null)

  React.useEffect(() => {
    setCurrent(initialState)
    setProposedMode(initialState.mode)
    setProposedStrategy(initialState.mappingStrategy || 'engine_tenant_id')
    setPreview(null)
    setAcknowledgements(new Set())
    setMappingForm(EMPTY_MAPPING_FORM)
    setMappingPreview(null)
  }, [engine.id, initialState])

  const diagnosticsQ = useQuery({
    queryKey: ['engines', engine.id, 'tenancy-diagnostics'],
    queryFn: () => getEngineTenancyDiagnostics(engine.id),
  })
  const mappingsQ = useQuery({
    queryKey: ['engines', engine.id, 'tenant-mappings'],
    enabled: canManage && current.mode === 'shared',
    queryFn: () => getEngineTenantMappings(engine.id),
  })

  const proposed = React.useMemo(
    () => buildEngineTenancyConfiguration(proposedMode, proposedStrategy),
    [proposedMode, proposedStrategy],
  )
  const transitionChanged = hasEngineTenancyTransition(current, proposed)

  React.useEffect(() => {
    setPreview(null)
    setAcknowledgements(new Set())
  }, [proposedMode, proposedStrategy])

  React.useEffect(() => {
    setMappingPreview(null)
  }, [
    mappingForm.active,
    mappingForm.existingTenantId,
    mappingForm.externalTenantId,
    mappingForm.sourceRef,
    mappingForm.target,
    mappingForm.tenantKey,
  ])

  const previewTransitionM = useMutation({
    mutationFn: () => previewEngineTenancyTransition(engine.id, { tenancy: proposed }),
    onSuccess: (result) => {
      setPreview(result)
      setAcknowledgements(new Set())
    },
    onError: (error) => notify({
      kind: 'error',
      title: 'Topology preview failed',
      subtitle: getUiErrorMessage(error, 'Failed to preview topology transition'),
    }),
  })
  const applyTransitionM = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error('Create a current preview before applying')
      return applyEngineTenancyTransition(engine.id, {
        tenancy: proposed,
        previewHash: preview.previewHash,
        previewExpiresAt: preview.previewExpiresAt,
        acknowledgements: preview.requiredAcknowledgements.filter((item) => acknowledgements.has(item)),
      })
    },
    onSuccess: (result) => {
      setCurrent(result.transition.proposed)
      setProposedMode(result.transition.proposed.mode)
      setProposedStrategy(result.transition.proposed.mappingStrategy || 'engine_tenant_id')
      setPreview(null)
      setAcknowledgements(new Set())
      queryClient.invalidateQueries({ queryKey: ['engines'] })
      queryClient.invalidateQueries({ queryKey: ['engines', engine.id, 'tenancy-diagnostics'] })
      queryClient.invalidateQueries({ queryKey: ['engines', engine.id, 'tenant-mappings'] })
      notify({ kind: 'success', title: 'Engine topology updated' })
    },
    onError: (error) => notify({
      kind: 'error',
      title: 'Topology transition failed',
      subtitle: getUiErrorMessage(error, 'Failed to apply topology transition'),
    }),
  })

  const currentDiagnostics: EngineTenancyDiagnostics | undefined = diagnosticsQ.data || {
    mode: current.mode,
    tenantId: current.tenantId,
    mappingStrategy: current.mappingStrategy,
    mappingVersion: current.mappingVersion,
    resolutionStatus: current.resolutionStatus,
    lastReconciledAt: null,
    mappedResourceCount: 0,
    unmappedResourceCount: 0,
    conflictingResourceCount: 0,
  }
  const currentMappingStrategy = current.mappingStrategy || 'explicit'
  const mappingVersion = currentDiagnostics.mappingVersion
  const mappingFormValid = Boolean(
    (currentMappingStrategy === 'deployment_target' || mappingForm.externalTenantId.trim())
    && (mappingForm.target !== 'key' || mappingForm.tenantKey.trim())
    && (mappingForm.target !== 'existing' || mappingForm.existingTenantId),
  )
  const previewMappingM = useMutation({
    mutationFn: () => upsertEngineTenantMappings(
      engine.id,
      buildEngineTenantMappingRequest(mappingForm, currentMappingStrategy, mappingVersion, true),
    ),
    onSuccess: setMappingPreview,
    onError: (error) => notify({
      kind: 'error',
      title: 'Mapping preview failed',
      subtitle: getUiErrorMessage(error, 'Failed to preview tenant mapping'),
    }),
  })
  const applyMappingM = useMutation({
    mutationFn: () => upsertEngineTenantMappings(
      engine.id,
      buildEngineTenantMappingRequest(mappingForm, currentMappingStrategy, mappingVersion, false),
    ),
    onSuccess: (result) => {
      setMappingPreview(null)
      setMappingForm(EMPTY_MAPPING_FORM)
      queryClient.invalidateQueries({ queryKey: ['engines'] })
      queryClient.invalidateQueries({ queryKey: ['engines', engine.id, 'tenancy-diagnostics'] })
      queryClient.invalidateQueries({ queryKey: ['engines', engine.id, 'tenant-mappings'] })
      notify({
        kind: 'success',
        title: 'Tenant mapping applied',
        subtitle: `Mapping version ${result.mappingVersion}`,
      })
    },
    onError: (error) => notify({
      kind: 'error',
      title: 'Mapping apply failed',
      subtitle: getUiErrorMessage(error, 'Failed to apply tenant mapping'),
    }),
  })

  const allAcknowledged = Boolean(
    preview
    && preview.requiredAcknowledgements.every((item) => acknowledgements.has(item)),
  )

  return (
    <section
      aria-label="Tenant ownership and tenant mappings"
      style={{
        border: '1px solid var(--color-border-primary)',
        borderRadius: 8,
        padding: 'var(--spacing-4)',
        background: 'var(--color-bg-secondary)',
        display: 'grid',
        gap: 'var(--spacing-5)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Tenant ownership and tenant mappings</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--color-text-secondary)', fontSize: 13 }}>
            This controls which EnterpriseGlue tenant owns each runtime resource. It does not map users or authorization groups.
          </p>
        </div>
        <Tag type={statusTagType(currentDiagnostics.resolutionStatus)}>
          {formatStatus(currentDiagnostics.resolutionStatus)}
        </Tag>
      </div>

      <Metrics diagnostics={currentDiagnostics} loading={diagnosticsQ.isLoading} error={diagnosticsQ.error} />

      {!canManage && (
        <InlineNotification
          lowContrast
          hideCloseButton
          kind="info"
          title="Topology is read-only"
          subtitle={managementReason || 'Engine edit permission is required to change topology or tenant mappings.'}
        />
      )}

      <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: 14 }}>Change who can use this engine</h4>
          <p style={{ margin: '4px 0 0', color: 'var(--color-text-secondary)', fontSize: 13 }}>
            Previewing a change shows which resources, assignments, and mappings will be affected before anything is updated.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-3)' }}>
          <div className="eg-explained-dropdown">
            <Dropdown
              id={`engine-${engine.id}-proposed-topology`}
              titleText="Who will use this engine? (required)"
              label="Choose tenant ownership"
              items={TOPOLOGY_OPTIONS}
              itemToString={(item) => item?.label || ''}
              itemToElement={optionElement}
              selectedItem={TOPOLOGY_OPTIONS.find((item) => item.id === proposedMode)}
              onChange={({ selectedItem }) => {
                if (selectedItem) setProposedMode(selectedItem.id)
              }}
              disabled={!canManage || previewTransitionM.isPending || applyTransitionM.isPending}
            />
            <p style={{ margin: '8px 0 0', color: 'var(--color-text-secondary)', fontSize: 13, lineHeight: 1.4 }}>
              {TOPOLOGY_OPTIONS.find((item) => item.id === proposedMode)?.description}
            </p>
          </div>
          {proposedMode === 'shared' && (
            <div className="eg-explained-dropdown">
              <Dropdown
                id={`engine-${engine.id}-proposed-mapping-strategy`}
                titleText="How runtime resources map to tenants (required)"
                label="Choose a tenant mapping method"
                items={MAPPING_STRATEGIES}
                itemToString={(item) => item?.label || ''}
                itemToElement={optionElement}
                selectedItem={MAPPING_STRATEGIES.find((item) => item.id === proposedStrategy)}
                onChange={({ selectedItem }) => {
                  if (selectedItem) setProposedStrategy(selectedItem.id)
                }}
                disabled={!canManage || previewTransitionM.isPending || applyTransitionM.isPending}
              />
              <p style={{ margin: '8px 0 0', color: 'var(--color-text-secondary)', fontSize: 13, lineHeight: 1.4 }}>
                {MAPPING_STRATEGIES.find((item) => item.id === proposedStrategy)?.description}
              </p>
            </div>
          )}
        </div>
        {proposedMode === 'shared' && (
          <InlineNotification
            lowContrast
            hideCloseButton
            kind="warning"
            title="Shared engines hide unresolved resources"
            subtitle="The transition quarantines runtime inventory until the selected method resolves exactly one tenant. Engine Set access alone does not authorize shared runtime resources."
          />
        )}
        <div>
          <Button
            size="sm"
            kind="secondary"
            disabled={!canManage || !transitionChanged || previewTransitionM.isPending || applyTransitionM.isPending}
            onClick={() => previewTransitionM.mutate()}
          >
            Preview topology change
          </Button>
        </div>
        {preview && (
          <>
            <TransitionEffects preview={preview} />
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Required acknowledgements</legend>
              {preview.requiredAcknowledgements.map((item) => (
                <label key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={acknowledgements.has(item)}
                    onChange={(event) => {
                      setAcknowledgements((currentItems) => {
                        const next = new Set(currentItems)
                        if (event.target.checked) next.add(item)
                        else next.delete(item)
                        return next
                      })
                    }}
                  />
                  {ACKNOWLEDGEMENT_LABELS[item]}
                </label>
              ))}
            </fieldset>
            <div>
              <Button
                size="sm"
                kind="danger"
                disabled={!allAcknowledged || applyTransitionM.isPending}
                onClick={() => applyTransitionM.mutate()}
              >
                Apply reviewed topology change
              </Button>
            </div>
          </>
        )}
      </div>

      {current.mode === 'shared' && (
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <h4 style={{ margin: 0, fontSize: 14 }}>Tenant mappings</h4>
          {!canManage ? null : mappingsQ.isLoading ? (
            <InlineLoading description="Loading tenant mappings" />
          ) : mappingsQ.error ? (
            <InlineNotification
              lowContrast
              hideCloseButton
              kind="error"
              title="Tenant mappings unavailable"
              subtitle={getUiErrorMessage(mappingsQ.error, 'Failed to load tenant mappings')}
            />
          ) : (mappingsQ.data || []).length === 0 ? (
            <InlineNotification
              lowContrast
              hideCloseButton
              kind="warning"
              title="No tenant mappings"
              subtitle="Runtime resources remain quarantined until the selected strategy can resolve them."
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['External tenant', 'Enterprise tenant', 'Strategy', 'Source', 'Status', ''].map((heading) => (
                      <th key={heading} style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid var(--color-border-subtle)' }}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(mappingsQ.data || []).map((mapping) => (
                    <tr key={mapping.id}>
                      <td style={{ padding: 8 }}>{mapping.externalTenantId || '(deployment target)'}</td>
                      <td style={{ padding: 8 }}>{mapping.enterpriseTenantId}</td>
                      <td style={{ padding: 8 }}>{formatStatus(mapping.strategy)}</td>
                      <td style={{ padding: 8 }}>{formatStatus(mapping.source)}</td>
                      <td style={{ padding: 8 }}>
                        <Tag size="sm" type={mapping.isActive ? 'green' : 'gray'}>{mapping.isActive ? 'Active' : 'Inactive'}</Tag>
                      </td>
                      <td style={{ padding: 8 }}>
                        <Button
                          size="sm"
                          kind="ghost"
                          disabled={mapping.ownershipMode === 'config_locked' || mapping.ownershipMode === 'external_managed'}
                          onClick={() => {
                            setMappingForm(mappingFormFromRow(mapping))
                            setMappingPreview(null)
                          }}
                        >
                          Review change
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canManage && (
            <div
              style={{
                display: 'grid',
                gap: 'var(--spacing-3)',
                borderTop: '1px solid var(--color-border-subtle)',
                paddingTop: 'var(--spacing-3)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>Preview one atomic mapping change</strong>
                <Button size="sm" kind="ghost" onClick={() => setMappingForm(EMPTY_MAPPING_FORM)}>Clear</Button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 'var(--spacing-3)' }}>
                <TextInput
                  id={`engine-${engine.id}-external-tenant`}
                  labelText={currentMappingStrategy === 'deployment_target' ? 'External tenant or target key (optional)' : 'External tenant ID'}
                  value={mappingForm.externalTenantId}
                  onChange={(event) => setMappingForm((value) => ({ ...value, externalTenantId: event.target.value }))}
                />
                <TextInput
                  id={`engine-${engine.id}-mapping-source`}
                  labelText="Source reference"
                  placeholder="manual:team-a"
                  value={mappingForm.sourceRef}
                  onChange={(event) => setMappingForm((value) => ({ ...value, sourceRef: event.target.value }))}
                />
                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  Enterprise tenant target
                  <select
                    aria-label="Enterprise tenant target"
                    value={mappingForm.target}
                    onChange={(event) => setMappingForm((value) => ({
                      ...value,
                      target: event.target.value as MappingTenantTarget,
                    }))}
                    style={{ minHeight: 40, padding: '0 12px' }}
                  >
                    {mappingForm.existingTenantId && <option value="existing">Keep existing target ({mappingForm.existingTenantId})</option>}
                    <option value="request_context">Current tenant</option>
                    <option value="default">Default tenant</option>
                    <option value="key">Stable tenant key</option>
                  </select>
                </label>
                {mappingForm.target === 'key' && (
                  <TextInput
                    id={`engine-${engine.id}-tenant-key`}
                    labelText="Stable tenant key"
                    placeholder="tenant.team-a"
                    value={mappingForm.tenantKey}
                    onChange={(event) => setMappingForm((value) => ({ ...value, tenantKey: event.target.value }))}
                  />
                )}
              </div>
              <Toggle
                id={`engine-${engine.id}-mapping-active`}
                labelText="Mapping status"
                labelA="Inactive"
                labelB="Active"
                toggled={mappingForm.active}
                onToggle={(active) => setMappingForm((value) => ({ ...value, active }))}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  kind="secondary"
                  disabled={!mappingFormValid || previewMappingM.isPending || applyMappingM.isPending}
                  onClick={() => previewMappingM.mutate()}
                >
                  Preview mapping change
                </Button>
                <Button
                  size="sm"
                  disabled={!mappingPreview || applyMappingM.isPending}
                  onClick={() => applyMappingM.mutate()}
                >
                  Apply mapping change
                </Button>
              </div>
              {mappingPreview && (
                <InlineNotification
                  lowContrast
                  hideCloseButton
                  kind={mappingPreview.results.some((result) => result.status === 'rejected') ? 'error' : 'info'}
                  title={`Mapping preview at version ${mappingPreview.mappingVersion}`}
                  subtitle={`Create ${mappingPreview.created}; update ${mappingPreview.updated}; deactivate ${mappingPreview.deactivated}; unchanged ${mappingPreview.unchanged}.`}
                />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
