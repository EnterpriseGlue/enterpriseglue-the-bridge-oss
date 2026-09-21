import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { safeRelativePath } from '../../../shared/utils/sanitize'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  InlineLoading,
  InlineNotification,
  TextInput,
  Dropdown,
  Tag,
  DataTable,
  DataTableSkeleton,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Toggle,
} from '@carbon/react'
import { Add, Chip } from '@carbon/icons-react'
import FormModal from '../../../components/FormModal'
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../../shared/components/PageLayout'
import { useModal } from '../../../shared/hooks/useModal'
import { useAuth } from '../../../shared/hooks/useAuth'
import type { CurrentUserPermissions } from '../../../shared/types/auth'
import { useToast } from '../../../shared/notifications/ToastProvider'
import { getUiErrorMessage } from '../../../shared/api/apiErrorUtils'
import { EngineAccessError, isEngineAccessError } from '../shared/components/EngineAccessError'
import { apiClient } from '../../../shared/api/client'
import { fetchList } from '../../../shared/api/fetchList';
import EngineMembersModal from './components/EngineMembersModal'
import EngineTenancyPanel from './components/EngineTenancyPanel'
import CamundaNativeGrantMigrationPanel from './components/CamundaNativeGrantMigrationPanel'
import EngineBackstopPanel from './components/EngineBackstopPanel'
import { EnginePermission } from '../../../shared/auth/permissions'
import { evaluateActionSnapshot, GuardedOverflowMenu, GuardedOverflowMenuItem, useActionDecision } from '../../../shared/auth/guards'
import { NativePluginSlotV1 } from '../../../plugins/nativePluginRuntime'
import type { DeploymentHistoryView, DeploymentLineageView, DeploymentReceiptView } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js'
import { isEngineBackstopNativeAuthorizationEngineType } from '@enterpriseglue/shared/schemas/platform-admin/engine-backstop.js'
import type {
  EngineOnboardingMode,
  PlatformSettings,
} from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js'
import type {
  CreateEngineRequest,
  AccessibleEngineSummary,
  EngineAuthType,
  EngineConnectionMode,
  EngineTenantMappingStrategy,
  EngineType,
  UpdateEngineRequest,
} from '@enterpriseglue/shared/schemas/mission-control/engine.js'
import type {
  EngineMember as SharedEngineMember,
  EngineMembersResponse as SharedEngineMembersResponse,
} from '@enterpriseglue/shared/schemas/platform-admin/engine-management.js'
import type {
  RoleAssignment as SharedRoleAssignment,
  ProjectEngineTarget as SharedProjectEngineTarget,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js'
import { useRuntimeResources, useRuntimeResourceSets } from '../../platform-admin/hooks/useAuthzApi'
import { createEngine, deleteEngine as deleteEngineRequest, getManageableEngines, getEngineConnectionHealth, getEngineDeploymentHistory, getEngineDeploymentLineage, getEngineDeploymentReceipts, getEngineEnvironmentTags, getEngineMembers, getEngineProjectTargets, setEngineEnvironment, testEngineConnection, updateEngine } from './api/engines'
import { engineHealthQueryPolicy } from './engineHealthQueryPolicy'

function getDockerLoopbackSuggestion(raw: string): string | null {
  try {
    const parsed = new URL(raw)
    if (!/^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/.test(parsed.hostname)) return null
    parsed.hostname = 'host.docker.internal'
    return parsed.toString()
  } catch {
    return null
  }
}

type EngineTypeId = 'ion' | 'operaton' | 'camunda7'
type RuntimeAccessScope = 'engine_wide' | 'resource_aware'
type DeploymentIntegration = 'enterpriseglue_proxy' | 'direct_engine'

type EngineChoice = {
  id: string
  label: string
  description: string
}

type FieldRequirement = 'Required' | 'Optional' | 'Conditional'

const ENGINE_TYPE_ITEMS: EngineChoice[] = [
  { id: 'ion', label: 'ION Engine', description: 'Connect to an EnterpriseGlue ION workflow engine.' },
  { id: 'operaton', label: 'Operaton', description: 'Connect through an Operaton-compatible REST API.' },
  { id: 'camunda7', label: 'Camunda 7', description: 'Connect through a Camunda 7-compatible REST API.' },
]

const AUTH_ITEMS: EngineChoice[] = [
  {
    id: 'basic',
    label: 'Username and password',
    description: 'EnterpriseGlue sends HTTP Basic credentials to the endpoint on every request.',
  },
  {
    id: 'bearer',
    label: 'Bearer token',
    description: 'EnterpriseGlue sends a fixed API token to the endpoint on every request.',
  },
  {
    id: 'oauth2-client-credentials',
    label: 'OAuth 2.0 client credentials',
    description: 'EnterpriseGlue obtains short-lived access tokens using a client ID, client secret, and token URL.',
  },
  {
    id: 'none',
    label: 'No EnterpriseGlue-managed credentials',
    description: 'Available only for an approved customer-managed sidecar or gateway that authenticates the downstream engine itself.',
  },
]

const CONNECTION_MODE_ITEMS: EngineChoice[] = [
  {
    id: 'direct',
    label: 'Connect directly to the engine',
    description: 'The endpoint URL is the engine REST API. EnterpriseGlue authenticates directly with the engine.',
  },
  {
    id: 'customer_sidecar',
    label: 'Connect through a customer gateway or sidecar',
    description: 'The endpoint URL is a customer-managed gateway. The gateway owns the separate connection and credentials to the engine.',
  },
]

const RUNTIME_ACCESS_SCOPE_ITEMS: EngineChoice[] = [
  {
    id: 'engine_wide',
    label: 'Grant access to the whole engine',
    description: 'A person with engine access can use every process, decision, and runtime resource visible through this engine.',
  },
  {
    id: 'resource_aware',
    label: 'Grant access to selected runtime resources',
    description: 'Use Access Control to grant specific processes, decisions, or Runtime Resource Sets after saving the engine.',
  },
]

const TENANCY_MODE_ITEMS: EngineChoice[] = [
  {
    id: 'dedicated',
    label: 'One tenant — this tenant',
    description: 'Use this engine only for the tenant you are currently administering. No tenant mapping is needed.',
  },
  {
    id: 'shared',
    label: 'Multiple tenants — map each runtime resource',
    description: 'Share one engine across tenants. Every runtime resource must resolve to exactly one tenant before it becomes visible.',
  },
]

const TENANT_MAPPING_STRATEGY_ITEMS: EngineChoice[] = [
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

const DEPLOYMENT_INTEGRATION_ITEMS: EngineChoice[] = [
  {
    id: 'enterpriseglue_proxy',
    label: 'Deploy through EnterpriseGlue',
    description: 'Authorized users deploy project files through EnterpriseGlue, which forwards them to the engine and records lineage.',
  },
  {
    id: 'direct_engine',
    label: 'Deploy from an external pipeline',
    description: 'A customer pipeline deploys directly to the engine and sends EnterpriseGlue a deployment receipt for lineage and inventory.',
  },
]

function requirementTagType(requirement: FieldRequirement): 'blue' | 'purple' | 'cool-gray' {
  if (requirement === 'Required') return 'blue'
  if (requirement === 'Conditional') return 'purple'
  return 'cool-gray'
}

function SettingExplanation({
  description,
  requirement,
  id,
}: {
  description: string
  requirement: FieldRequirement
  id?: string
}) {
  return (
    <div
      id={id}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-2)', marginTop: 'var(--spacing-2)' }}
    >
      <Tag size="sm" type={requirementTagType(requirement)}>{requirement}</Tag>
      <span style={{ color: 'var(--cds-text-secondary)', fontSize: '0.8125rem', lineHeight: 1.4 }}>
        {description}
      </span>
    </div>
  )
}

function ExplainedDropdown({
  id,
  title,
  placeholder,
  items,
  selectedId,
  onChange,
  disabled = false,
  requirement = 'Required',
}: {
  id: string
  title: string
  placeholder: string
  items: EngineChoice[]
  selectedId: string
  onChange: (id: string) => void
  disabled?: boolean
  requirement?: FieldRequirement
}) {
  const selectedItem = items.find((item) => item.id === selectedId) || null
  const descriptionId = `${id}-description`
  return (
    <div className="eg-explained-dropdown">
      <Dropdown
        id={id}
        aria-describedby={descriptionId}
        titleText={`${title} (${requirement.toLowerCase()})`}
        label={placeholder}
        items={items}
        itemToString={(item: EngineChoice | null) => item?.label || ''}
        itemToElement={(item: EngineChoice | null) => (
          <div style={{ display: 'grid', gap: '0.125rem', paddingBlock: '0.125rem', whiteSpace: 'normal' }}>
            <span style={{ fontWeight: 500 }}>{item?.label || ''}</span>
            <span style={{ color: 'var(--cds-text-secondary)', fontSize: '0.75rem', lineHeight: 1.35 }}>
              {item?.description || ''}
            </span>
          </div>
        )}
        selectedItem={selectedItem}
        onChange={({ selectedItem: nextItem }: { selectedItem?: EngineChoice | null }) => {
          if (nextItem?.id) onChange(nextItem.id)
        }}
        disabled={disabled}
      />
      <SettingExplanation
        id={descriptionId}
        requirement={requirement}
        description={selectedItem?.description || 'Choose the option that matches your environment.'}
      />
    </div>
  )
}

function EngineFormSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children: React.ReactNode
}) {
  const headingId = `${id}-heading`
  return (
    <section
      aria-labelledby={headingId}
      style={{
        display: 'grid',
        gap: 'var(--spacing-5)',
        padding: 'var(--spacing-5)',
        border: '1px solid var(--cds-border-subtle)',
        borderRadius: 8,
        background: 'var(--cds-layer-01)',
      }}
    >
      <div>
        <h3 id={headingId} style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{title}</h3>
        <p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)', fontSize: '0.875rem', lineHeight: 1.45 }}>
          {description}
        </p>
      </div>
      {children}
    </section>
  )
}

export type EngineMutationForm = {
  name: string
  baseUrl: string
  type: EngineType
  authType: EngineAuthType
  connectionMode: EngineConnectionMode
  username: string
  passwordEnc: string
  oauthTokenUrl: string
  oauthScopes: string
  oauthAudience: string
  environmentTagId: string
  tenancyMode: 'dedicated' | 'shared'
  tenantMappingStrategy: EngineTenantMappingStrategy
  runtimeAccessScope: RuntimeAccessScope
  deploymentIntegration: DeploymentIntegration
  metadataDiscoveryEnabled: boolean
  deploymentDiscoveryEnabled: boolean
  reconciliationIntervalSeconds: number
  pipelineReceiptEnabled: boolean
}

type EngineMutationPayload = CreateEngineRequest | UpdateEngineRequest
type EngineOnboardingSettings = Pick<PlatformSettings,
  'engineOnboardingMode' | 'engineAccessAuthority' | 'credentiallessCustomerSidecarsEnabled' | 'governanceBehavior'>

export function isOAuth2ClientCredentialsFormIncomplete(
  form: Pick<EngineMutationForm, 'authType' | 'username' | 'passwordEnc' | 'oauthTokenUrl'>,
  editing?: { hasCredential?: boolean } | null,
): boolean {
  return form.authType === 'oauth2-client-credentials'
    && (!form.username || (!form.passwordEnc && !editing?.hasCredential) || !form.oauthTokenUrl)
}

const ENGINE_TYPE_LABELS: Record<EngineTypeId, string> = {
  ion: 'ION-Engine',
  operaton: 'Operaton',
  camunda7: 'Camunda 7',
}

function normalizeEngineType(type: unknown): EngineTypeId {
  if (type === 'ion' || type === 'operaton' || type === 'camunda7') return type
  return 'camunda7'
}

type EnginePermissionCheck = (engineId: string | null | undefined, permission: string) => boolean
type EngineActionCheck = (engineId: string | null | undefined, actionId: string) => boolean
type EngineActionSubject = Pick<AccessibleEngineSummary, 'id'> | null | undefined

export function getEngineActionPermissions(
  engine: EngineActionSubject,
  hasPermission: EnginePermissionCheck,
  hasAction?: EngineActionCheck,
  useServerActionAvailability = false,
) {
  const engineId = engine?.id
  const hasActionDecision = (actionId: string) => Boolean(engineId && hasAction?.(engineId, actionId))
  const hasPermissionOrAction = (permission: string, actionId?: string) =>
    actionId && useServerActionAvailability
      ? hasActionDecision(actionId)
      : hasPermission(engineId, permission) || Boolean(actionId && hasActionDecision(actionId))
  const canManageMembers = hasPermissionOrAction(EnginePermission.MEMBERS_MANAGE)
  const canManageMembersForMutation = useServerActionAvailability ? false : canManageMembers
  const canLookupMembers = canManageMembers || hasPermissionOrAction(EnginePermission.MEMBERS_LOOKUP, 'engine.members.lookup')
  const canInviteMembers = canManageMembersForMutation || hasPermissionOrAction(EnginePermission.MEMBERS_INVITE, 'engine.members.invite')
  const canAddMembers = canManageMembersForMutation || hasPermissionOrAction(EnginePermission.MEMBERS_ADD, 'engine.members.add')
  const canUpdateMemberRoles = canManageMembersForMutation || hasPermissionOrAction(EnginePermission.MEMBERS_UPDATE_ROLE, 'engine.members.update-role')
  const canRemoveMembers = canManageMembersForMutation || hasPermissionOrAction(EnginePermission.MEMBERS_REMOVE, 'engine.members.remove')
  const canManageDelegate = hasPermissionOrAction(EnginePermission.DELEGATE_MANAGE, 'engine.delegate.manage')
  const canViewProjectAccess = canManageMembers || hasPermissionOrAction(EnginePermission.PROJECT_ACCESS_VIEW, 'engine.project-access.requests.read')
  const canApproveProjectAccess = canManageMembers || hasPermissionOrAction(EnginePermission.PROJECT_ACCESS_APPROVE, 'engine.project-access.requests.approve')
  const canDenyProjectAccess = canManageMembers || hasPermissionOrAction(EnginePermission.PROJECT_ACCESS_DENY, 'engine.project-access.requests.deny')
  const canRevokeProjectAccess = canManageMembers || hasPermissionOrAction(EnginePermission.PROJECT_ACCESS_REVOKE, 'engine.project-access.revoke')
  const canSetEnvironment = hasPermissionOrAction(EnginePermission.ENVIRONMENT_SET, 'engine.environment.set')
  const canLockEnvironment = hasPermissionOrAction(EnginePermission.ENVIRONMENT_LOCK, 'engine.environment.lock')
  const canTransferOwnership = hasPermissionOrAction(EnginePermission.OWNERSHIP_TRANSFER, 'engine.ownership.transfer')
  const canViewDeployments = hasPermissionOrAction(EnginePermission.DEPLOY_VIEW, 'engine.deployments.read')
  const canViewMembers = hasPermissionOrAction(EnginePermission.MEMBERS_VIEW, 'engine.members.read') || canLookupMembers
  const canManageSecrets = hasPermissionOrAction(EnginePermission.SECRETS_MANAGE, 'engine.secrets.manage')
  const canViewSecrets = hasPermissionOrAction(EnginePermission.SECRETS_VIEW, 'engine.secrets.view') || canManageSecrets

  return {
    canEdit: hasPermissionOrAction(EnginePermission.ENGINE_EDIT, 'engine.inventory.configuration.update'),
    canDelete: hasPermissionOrAction(EnginePermission.ENGINE_DELETE, 'engine.inventory.delete'),
    canTest: hasPermissionOrAction(EnginePermission.ENGINE_EDIT, 'engine.inventory.update'),
    canViewSecrets,
    canManageSecrets,
    canViewMembers,
    canManageMembers,
    canLookupMembers,
    canInviteMembers,
    canAddMembers,
    canUpdateMemberRoles,
    canRemoveMembers,
    canManageDelegate,
    canTransferOwnership,
    canViewDeployments,
    canViewProjectAccess,
    canApproveProjectAccess,
    canDenyProjectAccess,
    canRevokeProjectAccess,
    canSetEnvironment,
    canLockEnvironment,
    canOpenMembers: canViewMembers || canManageMembers || canInviteMembers || canAddMembers || canUpdateMemberRoles || canRemoveMembers || canManageDelegate || canViewProjectAccess,
  }
}

type EngineActionPermissions = ReturnType<typeof getEngineActionPermissions>
type EngineInventory = AccessibleEngineSummary
type EngineInventoryPresentation = {
  registrationSource?: string | null
  externalId?: string | null
  ownershipMode?: string | null
  lifecycleStatus?: string | null
  driftStatus?: string | null
  capabilityStatus?: string | null
}

function getEngineInventoryReadDecision(engine: EngineActionSubject, permissions: CurrentUserPermissions | null | undefined) {
  return evaluateActionSnapshot(permissions, 'engine.inventory.read', { type: 'engine', id: engine?.id ?? null })
}

function EnginePluginActions({
  engineRef,
  displayName,
  product,
  productVersion,
}: {
  engineRef: string
  displayName?: string
  product?: string
  productVersion?: string
}) {
  const pluginActionDecision = useActionDecision(
    'engine.instances.read',
    { type: 'engine', id: engineRef },
  )

  return (
    <NativePluginSlotV1
      slot="mission-control.engine.actions.v1"
      context={{
        schemaVersion: 1,
        disabled: !pluginActionDecision.allowed,
        engineRef,
        ...(displayName ? { displayName } : {}),
        ...(product ? { product } : {}),
        ...(productVersion ? { productVersion } : {}),
      }}
    />
  )
}

export type EngineDetailSectionId = 'registration' | 'access' | 'deployment' | 'runtime'

export function resolveEngineDetailSections(options: {
  isEditing?: boolean
  canViewMembers?: boolean
  canViewProjectAccess?: boolean
  canViewRuntimeResources?: boolean
  canViewDeployments?: boolean
}): EngineDetailSectionId[] {
  const sections: EngineDetailSectionId[] = []
  if (options.isEditing) sections.push('registration')
  if (options.canViewMembers || options.canViewRuntimeResources) sections.push('access')
  if (options.canViewProjectAccess || options.canViewDeployments) sections.push('deployment')
  if (options.canViewRuntimeResources) sections.push('runtime')
  return sections
}

export type EngineRowDiagnosticTag = {
  label: string
  type: any
  title?: string
}

export function isExternallyRegisteredEngine(engine: EngineInventoryPresentation | null | undefined): boolean {
  return engine?.registrationSource === 'external_api' || Boolean(engine?.externalId)
}

export function isExternallyManagedEngine(engine: EngineInventoryPresentation | null | undefined): boolean {
  return engine?.registrationSource === 'external_api'
}

export function isConfigLockedEngine(engine: EngineInventoryPresentation | null | undefined): boolean {
  return engine?.registrationSource === 'config' && engine?.ownershipMode === 'config_locked'
}

export function isConfigWarnEngine(engine: EngineInventoryPresentation | null | undefined): boolean {
  return engine?.registrationSource === 'config' && engine?.ownershipMode === 'config_warn'
}

export function formatEngineRegistrationSource(engine: EngineInventoryPresentation | null | undefined): string {
  if (engine?.registrationSource === 'config') return 'Configuration'
  if (engine?.registrationSource === 'external_api') return 'External API'
  if (engine?.registrationSource === 'user' || engine?.registrationSource === 'manual') return 'Manual'
  if (engine?.externalId) return 'External ID'
  return 'Manual'
}

export function formatEngineRegistrationStatus(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '-'
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function formatEngineLabels(labels: unknown): string {
  const entries = getEngineLabelEntries(labels)
  return entries.length > 0 ? entries.map(([key, value]) => `${key}=${value}`).join(', ') : '-'
}

export function getEngineLabelEntries(labels: unknown): Array<[string, string]> {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return []
  return Object.entries(labels as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0].trim().length > 0 && entry[1].trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
}

export type EngineMetadataFilterOption = { id: string; label: string }

const ENGINE_METADATA_FILTER_SEPARATOR = '\u0000'

export function getEngineMetadataFilterOptions(engines: ReadonlyArray<Pick<EngineInventory, 'labels'>>): EngineMetadataFilterOption[] {
  const entries = new Map<string, EngineMetadataFilterOption>()
  for (const engine of engines) {
    for (const [key, value] of getEngineLabelEntries(engine.labels)) {
      const id = `${key}${ENGINE_METADATA_FILTER_SEPARATOR}${value}`
      entries.set(id, { id, label: `${key}: ${value}` })
    }
  }
  return Array.from(entries.values()).sort((left, right) => left.label.localeCompare(right.label))
}

export function matchesEngineMetadataFilter(engine: Pick<EngineInventory, 'labels'> | null | undefined, filterId: string): boolean {
  if (!filterId) return true
  const separatorIndex = filterId.indexOf(ENGINE_METADATA_FILTER_SEPARATOR)
  if (separatorIndex < 1) return false
  const key = filterId.slice(0, separatorIndex)
  const value = filterId.slice(separatorIndex + ENGINE_METADATA_FILTER_SEPARATOR.length)
  return getEngineLabelEntries(engine?.labels).some(([entryKey, entryValue]) => entryKey === key && entryValue === value)
}

export function formatEngineFieldOwnership(ownership: unknown): string {
  if (!ownership || typeof ownership !== 'object' || Array.isArray(ownership)) return '-'
  const entries = Object.entries(ownership as Record<string, unknown>)
    .filter((entry): entry is [string, 'manual' | 'external'] => entry[1] === 'manual' || entry[1] === 'external')
    .sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) return '-'
  const external = entries.filter(([, owner]) => owner === 'external').map(([key]) => key)
  const manual = entries.filter(([, owner]) => owner === 'manual').map(([key]) => key)
  return [
    external.length ? `External: ${external.join(', ')}` : '',
    manual.length ? `Manual: ${manual.join(', ')}` : '',
  ].filter(Boolean).join(' | ') || '-'
}

export function formatEngineTimestamp(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-'
  return new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC')
}

export function formatEngineCapabilitySummary(capabilities: EngineInventory['capabilities'] | EngineInventory['reportedCapabilities']): string {
  if (!capabilities || typeof capabilities !== 'object') return '-'
  const profile = typeof capabilities.compatibilityProfile === 'string' ? capabilities.compatibilityProfile : ''
  const support = typeof capabilities.supportLevel === 'string' ? capabilities.supportLevel : ''
  const operations = Array.isArray(capabilities.operations) ? capabilities.operations.length : 0
  return [
    profile || null,
    support ? formatEngineRegistrationStatus(support) : null,
    operations ? `${operations} operation${operations === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(', ') || '-'
}

export function formatEngineCapabilityDiagnostics(diagnostics: Partial<NonNullable<EngineInventory['capabilityDiagnostics']>> | null | undefined): string {
  if (!diagnostics || typeof diagnostics !== 'object') return '-'
  if (diagnostics.status === 'in_sync') return 'All expected operations and query capabilities reported'
  if (Array.isArray(diagnostics.missingOperations) && diagnostics.missingOperations.length > 0) {
    return `Missing: ${diagnostics.missingOperations.join(', ')}`
  }
  if (Array.isArray(diagnostics.extraOperations) && diagnostics.extraOperations.length > 0) {
    return `Extra: ${diagnostics.extraOperations.join(', ')}`
  }
  if (Array.isArray(diagnostics.mismatchedQueryCapabilities) && diagnostics.mismatchedQueryCapabilities.length > 0) {
    return `Query filters: ${diagnostics.mismatchedQueryCapabilities.join(', ')}`
  }
  if (Array.isArray(diagnostics.reportedOperations) && diagnostics.reportedOperations.length === 0) {
    return 'No operation capabilities reported'
  }
  if (Array.isArray(diagnostics.issues) && typeof diagnostics.issues[0] === 'string') {
    return diagnostics.issues[0]
  }
  return typeof diagnostics.recommendation === 'string' ? diagnostics.recommendation : '-'
}

function getStringStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function getEngineRowDiagnosticTags(engine: EngineInventoryPresentation | null | undefined): EngineRowDiagnosticTag[] {
  if (!engine) return []
  const tags: EngineRowDiagnosticTag[] = []
  if (engine.registrationSource === 'config' || engine.ownershipMode === 'config_locked' || engine.ownershipMode === 'config_warn') {
    tags.push({ label: 'Managed by configuration', type: 'purple', title: 'Managed by an EnterpriseGlue configuration bundle' })
  } else if (isExternallyManagedEngine(engine)) {
    tags.push({ label: 'External API', type: getRegistrationTagType('external_api'), title: 'Registered by external API' })
  } else if (isExternallyRegisteredEngine(engine)) {
    tags.push({ label: 'External ID', type: getRegistrationTagType('external_api'), title: 'Has an external engine identifier' })
  }

  const lifecycleStatus = getStringStatus(engine.lifecycleStatus)
  if (lifecycleStatus && lifecycleStatus !== 'active') {
    tags.push({
      label: `Lifecycle: ${formatEngineRegistrationStatus(lifecycleStatus)}`,
      type: getRegistrationTagType(lifecycleStatus),
      title: 'Engine lifecycle state',
    })
  }

  const driftStatus = getStringStatus(engine.driftStatus)
  if (driftStatus && driftStatus !== 'in_sync' && driftStatus !== 'synced') {
    tags.push({
      label: `Drift: ${formatEngineRegistrationStatus(driftStatus)}`,
      type: getRegistrationTagType(driftStatus),
      title: 'External registration drift state',
    })
  }

  const capabilityStatus = getStringStatus(engine.capabilityStatus)
  if (capabilityStatus && capabilityStatus !== 'compatible') {
    tags.push({
      label: `Capability: ${formatEngineRegistrationStatus(capabilityStatus)}`,
      type: getRegistrationTagType(capabilityStatus),
      title: 'Reported engine capability status',
    })
  }

  return tags
}

export function getEngineLifecycleUnavailableReason(engine: EngineInventoryPresentation | null | undefined, actionLabel: string): string | null {
  const lifecycleStatus = getStringStatus(engine?.lifecycleStatus || 'active')
  if (lifecycleStatus === 'decommissioned') {
    return `Engine is decommissioned. Reactivate it from Access Control before ${actionLabel}.`
  }
  if (lifecycleStatus === 'disabled') {
    return `Engine is disabled. Reactivate it from Access Control before ${actionLabel}.`
  }
  return null
}

export function getEngineTestUnavailableReason(
  actions: Pick<EngineActionPermissions, 'canTest'> | null | undefined,
  engine?: EngineInventoryPresentation | null
): string | null {
  if (!actions?.canTest) return `Missing permission ${EnginePermission.ENGINE_EDIT}`
  return getEngineLifecycleUnavailableReason(engine, 'testing the connection')
}

export function getEngineMembersUnavailableReason(actions: Pick<EngineActionPermissions, 'canOpenMembers'> | null | undefined): string | null {
  return actions?.canOpenMembers ? null : `Missing permission ${EnginePermission.MEMBERS_VIEW}`
}

export function getEngineDeleteUnavailableReason(
  actions: Pick<EngineActionPermissions, 'canDelete'> | null | undefined,
  manualEngineOnboardingAllowed: boolean,
  engine?: EngineInventoryPresentation | null
): string | null {
  if (!actions?.canDelete) return `Missing permission ${EnginePermission.ENGINE_DELETE}`
  if (!manualEngineOnboardingAllowed) return 'Manual engine deletion is disabled by the current onboarding policy'
  if (isExternallyManagedEngine(engine)) {
    return 'Externally registered engines must be decommissioned from Access Control or the owning external system.'
  }
  const lifecycleReason = getEngineLifecycleUnavailableReason(engine, 'deleting the engine')
  if (lifecycleReason) return lifecycleReason
  return null
}

type ProjectEngineTargetView = SharedProjectEngineTarget

type EngineAccessMember = SharedEngineMember
type EngineMembersResponse = SharedEngineMembersResponse

type EngineRoleAssignment = SharedRoleAssignment
type EngineRoleAssignmentDisplay = Pick<SharedRoleAssignment, 'id' | 'roleId' | 'source'> & Partial<Pick<SharedRoleAssignment,
  'userId' | 'principalType' | 'principalId' | 'sourceRef'
>> & { sourceMappingId?: string | null }

type RuntimeResourceAccessInventory = {
  id: string
  resourceKind: 'process_definition' | 'decision_definition'
  resourceKey: string
  runtimeTenantId?: string | null
  projectId?: string | null
  source: string
  sourceRef?: string | null
  observedAt: number
  isActive?: boolean
}

type RuntimeResourceSetAccessInventory = {
  id: string
  key: string
  name: string
  resourceKind: 'process_definition' | 'decision_definition'
  selectorJson?: string
  runtimeTenantId?: string | null
  source: string
  sourceRef?: string | null
  lastAppliedAt?: number | null
  isArchived?: boolean
}

type ProjectEngineTargetPresentation = Partial<ProjectEngineTargetView>

export function formatProjectEngineTargetProject(target: ProjectEngineTargetPresentation | null | undefined): string {
  return target?.projectName || target?.projectId || '-'
}

export function formatProjectEngineTargetModes(target: ProjectEngineTargetPresentation | null | undefined): string {
  if (!target) return '-'
  const modes = [
    target.allowManualDeploy ? 'Manual' : null,
    target.allowCiDeploy ? 'CI' : null,
    target.allowApiDeploy ? 'API' : null,
    target.allowImport ? 'Import' : null,
  ].filter(Boolean)
  return modes.length > 0 ? modes.join(', ') : '-'
}

export function formatProjectEngineTargetStatus(value: unknown): string {
  return formatEngineRegistrationStatus(value || 'active')
}

export function formatEngineAccessMemberName(member: Partial<EngineAccessMember> & Pick<EngineAccessMember, 'userId'> | null | undefined): string {
  if (!member) return '-'
  const fullName = `${member.user?.firstName || ''}${member.user?.firstName && member.user?.lastName ? ' ' : ''}${member.user?.lastName || ''}`.trim()
  return fullName || member.user?.email || member.userId || '-'
}

export function formatEngineAccessPrincipal(assignment: EngineRoleAssignmentDisplay | null | undefined): string {
  if (!assignment) return '-'
  const type = assignment.principalType || (assignment.userId ? 'user' : 'principal')
  const id = assignment.principalId || assignment.userId || '-'
  const label = type === 'api_client'
    ? 'API client'
    : type === 'service_account'
      ? 'Service account'
      : type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ')
  return `${label}: ${id}`
}

export function formatEngineAccessRole(value: string | null | undefined): string {
  if (!value) return '-'
  if (value.startsWith('system.engine.')) {
    return formatEngineRegistrationStatus(value.replace('system.engine.', ''))
  }
  return formatEngineRegistrationStatus(value)
}

export function formatEngineAccessSourceLineage(assignment: EngineRoleAssignmentDisplay | null | undefined): string {
  if (!assignment) return '-'
  const source = String(assignment.source || '').toLowerCase()
  const sourceLabel = source === 'sso'
    ? 'SSO-managed assignment'
    : source === 'manual'
      ? 'Manual assignment'
      : source === 'system'
        ? 'System-managed assignment'
        : source === 'api'
          ? 'API-managed assignment'
          : source === 'legacy'
            ? 'Legacy-derived assignment'
            : `${formatEngineRegistrationStatus(source || 'unknown')} assignment`
  const parts = [sourceLabel]
  if (assignment.sourceRef) parts.push(`Source ref ${assignment.sourceRef}`)
  if (source === 'sso' && assignment.sourceMappingId) parts.push(`SSO mapping ${assignment.sourceMappingId}`)
  return parts.join('; ')
}

export function isEngineGovernanceRoleAssignment(assignment: EngineRoleAssignmentDisplay | null | undefined): boolean {
  return assignment?.roleId === 'system.engine.owner' || assignment?.roleId === 'system.engine.delegate'
}

const ENGINE_MEMBER_GOVERNANCE_LABELS: Record<string, string> = {
  owner: 'Accountable owner',
  delegate: 'Governance delegate',
}

export function formatEngineAccessMemberGovernance(member: EngineAccessMember | null | undefined): string {
  return ENGINE_MEMBER_GOVERNANCE_LABELS[String(member?.role || '')] || 'Scoped user access'
}

function isAccountableOwnerMember(member: EngineAccessMember): boolean {
  return String(member.role || '') === 'owner'
}

export function getEngineAccountableOwnerLabels(members: EngineAccessMember[]): string[] {
  return members
    .filter(isAccountableOwnerMember)
    .map(formatEngineAccessMemberName)
    .filter((label) => label !== '-')
}

export function getEngineEffectiveOwnerLabels(members: EngineAccessMember[], assignments: EngineRoleAssignmentDisplay[]): string[] {
  const accountableOwnerMembers = members.filter(isAccountableOwnerMember)
  const accountableOwnerIds = new Set(accountableOwnerMembers.map((member) => member.userId).filter(Boolean))
  const labels = [
    ...accountableOwnerMembers.map(formatEngineAccessMemberName),
    ...assignments
      .filter((assignment) => assignment.roleId === 'system.engine.owner')
      .filter((assignment) => !accountableOwnerIds.has(String(assignment.principalId || assignment.userId || '')))
      .map(formatEngineAccessPrincipal),
  ].filter((label) => label !== '-')
  return Array.from(new Set(labels))
}

function isManualEngineOnboardingAllowed(mode: EngineOnboardingMode | undefined): boolean {
  return (mode || 'manual_allowed') !== 'external_only'
}

export function formatEngineAuthentication(engine: { connectionMode?: string | null; authType?: string | null } | null | undefined): string {
  if (engine?.connectionMode === 'customer_sidecar') return 'Customer-managed engine authentication'
  if (engine?.authType === 'none') return 'No EnterpriseGlue-managed credentials'
  if (engine?.authType === 'basic') return 'EnterpriseGlue-managed basic authentication'
  if (engine?.authType === 'bearer') return 'EnterpriseGlue-managed bearer token'
  if (engine?.authType === 'oauth2-client-credentials') return 'EnterpriseGlue-managed OAuth2 client credentials'
  return 'EnterpriseGlue-managed authentication'
}

const ENGINE_SECRET_FORM_FIELDS = [
  'authType',
  'username',
  'passwordEnc',
  'oauthTokenUrl',
  'oauthScopes',
  'oauthAudience',
] as const

function getRegistrationTagType(value: unknown): any {
  if (value === 'external_api') return 'purple'
  if (value === 'decommissioned' || value === 'mismatch') return 'red'
  if (value === 'manual_override' || value === 'stale') return 'magenta'
  if (value === 'active' || value === 'in_sync') return 'green'
  if (value === 'external_managed') return 'cyan'
  if (value === 'hybrid') return 'blue'
  return 'gray'
}

function getTargetStatusTagType(value: unknown): any {
  if (value === 'active') return 'green'
  if (value === 'disabled') return 'magenta'
  if (value === 'archived') return 'gray'
  return 'gray'
}

function getSnapshotStatusTagType(value: unknown): any {
  if (value === 'active') return 'green'
  if (value === 'stale') return 'magenta'
  if (value === 'removed_by_sso' || value === 'removed_by_admin' || value === 'mapping_disabled') return 'purple'
  if (value === 'provider_identity_missing' || value === 'provider_group_missing' || value === 'engine_no_longer_matches_selector') return 'red'
  return 'gray'
}

function getDeploymentLineageTagType(value: DeploymentHistoryView['lineageQuality']): any {
  if (value === 'complete') return 'green'
  if (value === 'reported') return 'blue'
  if (value === 'discovered') return 'purple'
  return 'gray'
}

function formatDeploymentLineageReadiness(value: DeploymentHistoryView['lineageReadiness']): string {
  if (value === 'bridge_ready') return 'Bridge ready'
  if (value === 'version_resolution_required') return 'Version resolution required'
  if (value === 'validation_required') return 'Validation required'
  if (value === 'inventory_only') return 'Inventory only'
  return 'Incomplete lineage'
}

function formatDeploymentLineageIssue(value: string): string {
  if (value === 'missing_project_lineage') return 'Project lineage is missing.'
  if (value === 'no_artifacts_recorded') return 'No deployment artifacts were recorded.'
  if (value === 'artifacts_missing_file_lineage') return 'Artifacts are not linked to project files.'
  if (value === 'missing_reporting_principal') return 'The reporting principal is missing.'
  if (value === 'inference_not_validated') return 'Inferred lineage has not been validated.'
  return formatEngineRegistrationStatus(value)
}

function EngineRegistrationDetail({ label, value, tagValue }: { label: string; value: React.ReactNode; tagValue?: unknown }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: 4 }}>{label}</div>
      {tagValue ? (
        <Tag type={getRegistrationTagType(tagValue)} size="sm">{value}</Tag>
      ) : (
        <div style={{ fontSize: '13px', color: 'var(--color-text-primary)', overflowWrap: 'anywhere' }}>{value}</div>
      )}
    </div>
  )
}

function EngineDeploymentSection({
  canViewProjectAccess,
  error,
  history,
  historyError,
  historyLoading,
  lineage,
  lineageError,
  lineageLoading,
  onSelectLineage,
  selectedDeploymentId,
  isLoading,
  receipts,
  receiptsError,
  receiptsLoading,
  targets,
}: {
  canViewProjectAccess: boolean
  error: unknown
  history: DeploymentHistoryView[]
  historyError: unknown
  historyLoading: boolean
  lineage: DeploymentLineageView | undefined
  lineageError: unknown
  lineageLoading: boolean
  onSelectLineage: (deploymentId: string | null) => void
  selectedDeploymentId: string | null
  isLoading: boolean
  receipts: DeploymentReceiptView[]
  receiptsError: unknown
  receiptsLoading: boolean
  targets: ProjectEngineTargetView[]
}) {
  return (
    <section
      aria-label="Deployment targets"
      style={{
        border: '1px solid var(--color-border-primary)',
        borderRadius: 8,
        padding: 'var(--spacing-4)',
        background: 'var(--color-bg-secondary)',
        display: 'grid',
        gap: 'var(--spacing-4)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>Deployment targets</h3>
        {canViewProjectAccess && <Tag type="cyan" size="sm">{targets.length} targets</Tag>}
      </div>

      {!canViewProjectAccess ? (
        <InlineNotification
          lowContrast
          kind="info"
          title="Deployment targets unavailable"
          subtitle="Viewing project-engine deployment targets requires engine project access visibility permission."
          hideCloseButton
        />
      ) : isLoading ? (
        <InlineLoading description="Loading deployment targets" />
      ) : error ? (
        <InlineNotification
          lowContrast
          kind="error"
          title="Failed to load deployment targets"
          subtitle={getUiErrorMessage(error, 'Failed to load deployment targets')}
          hideCloseButton
        />
      ) : targets.length === 0 ? (
        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
          No project targets are configured for this engine.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          {targets.map((target) => (
            <div
              key={target.id}
              style={{
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 6,
                padding: 'var(--spacing-3)',
                display: 'grid',
                gap: 'var(--spacing-3)',
                background: 'var(--color-bg-primary)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)', overflowWrap: 'anywhere' }}>
                    {formatProjectEngineTargetProject(target)}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', overflowWrap: 'anywhere' }}>
                    {target.projectId}
                  </div>
                </div>
                <Tag type={getTargetStatusTagType(target.status)} size="sm">
                  {formatProjectEngineTargetStatus(target.status)}
                </Tag>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--spacing-3)' }}>
                <EngineRegistrationDetail label="Allowed modes" value={formatProjectEngineTargetModes(target)} />
                <EngineRegistrationDetail label="Source" value={formatEngineRegistrationStatus(target.source)} />
                <EngineRegistrationDetail label="Environment" value={target.environment?.name || '-'} />
                <EngineRegistrationDetail label="Last seen" value={formatEngineTimestamp(target.lastSeenAt)} />
                <EngineRegistrationDetail label="Updated" value={formatEngineTimestamp(target.updatedAt)} />
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--spacing-4)', display: 'grid', gap: 'var(--spacing-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>Deployment history</h4>
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
            <Tag type="green" size="sm">{history.filter((item) => item.lineageReadiness === 'bridge_ready').length} bridge ready</Tag>
            <Tag type="purple" size="sm">{history.filter((item) => item.lineageReadiness === 'inventory_only').length} inventory only</Tag>
            <Tag type="blue" size="sm">{history.length} records</Tag>
          </div>
        </div>
        {historyLoading ? <InlineLoading description="Loading deployment history" /> : historyError ? (
          <InlineNotification lowContrast kind="error" title="Failed to load deployment history" subtitle={getUiErrorMessage(historyError, 'Failed to load deployment history')} hideCloseButton />
        ) : history.length === 0 ? (
          <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>No deployment history has been recorded for this engine.</div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
            {history.slice(0, 10).map((deployment) => (
              <div key={deployment.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--spacing-3)', alignItems: 'start', padding: 'var(--spacing-3)', border: '1px solid var(--color-border-subtle)', borderRadius: 6, background: 'var(--color-bg-primary)' }}>
                <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{deployment.deploymentName || deployment.engineDeploymentId || deployment.id}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', overflowWrap: 'anywhere' }}>
                    {deployment.projectId ? `Project ${deployment.projectId}` : 'No project lineage'} | {deployment.resourceCount} resources
                  </div>
                  {deployment.reportingPrincipalId ? <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', overflowWrap: 'anywhere' }}>Reported by {deployment.reportingPrincipalId}</div> : null}
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{deployment.linkedArtifactCount || 0}/{deployment.artifactCount || 0} artifacts linked to project files</div>
                  {(deployment.lineageIssues || []).map((issue) => <div key={issue} style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{formatDeploymentLineageIssue(issue)}</div>)}
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {deployment.reconciledAt ? `Reconciled ${formatEngineTimestamp(deployment.reconciledAt)}` : `Recorded ${formatEngineTimestamp(deployment.deployedAt)}`}
                  </div>
                  {deployment.engineDeploymentId ? <div><Button kind="ghost" size="sm" onClick={() => onSelectLineage(deployment.engineDeploymentId)}>
                    {selectedDeploymentId === deployment.engineDeploymentId ? 'Viewing lineage' : 'View lineage'}
                  </Button></div> : null}
                </div>
                <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Tag type={getDeploymentLineageTagType(deployment.lineageQuality)} size="sm">{deployment.lineageQuality}</Tag>
                  <Tag type={deployment.lineageReadiness === 'bridge_ready' ? 'green' : deployment.lineageReadiness === 'inventory_only' ? 'purple' : 'magenta'} size="sm">{formatDeploymentLineageReadiness(deployment.lineageReadiness)}</Tag>
                  <Tag type={formatEngineRegistrationStatus(deployment.ingestionSource) === 'Config-managed' ? 'cyan' : 'gray'} size="sm">{deployment.ingestionSource}</Tag>
                </div>
              </div>
            ))}
          </div>
        )}
        {selectedDeploymentId ? (
          <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--spacing-3)', display: 'grid', gap: 'var(--spacing-2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-3)', alignItems: 'center', flexWrap: 'wrap' }}>
              <h5 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Deployment lineage: {selectedDeploymentId}</h5>
              <Button kind="ghost" size="sm" onClick={() => onSelectLineage(null)}>Close</Button>
            </div>
            {lineageLoading ? <InlineLoading description="Loading deployment lineage" /> : lineageError ? (
              <InlineNotification lowContrast kind="error" title="Failed to load deployment lineage" subtitle={getUiErrorMessage(lineageError, 'Failed to load deployment lineage')} hideCloseButton />
            ) : lineage ? (
              <>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  {lineage.reconciliationStatus === 'reconciled' ? `Reconciled ${formatEngineTimestamp(lineage.reconciledAt)}` : 'Reconciliation pending'} | {lineage.artifacts.length} runtime artifacts
                </div>
                {lineage.artifacts.length === 0 ? <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>No runtime artifact references were recorded.</div> : (
                  <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                    {lineage.artifacts.map((artifact, index) => <div key={`${artifact.artifactKind}-${artifact.runtimeResourceId || artifact.runtimeResourceKey || index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-3)', padding: 'var(--spacing-2)', border: '1px solid var(--color-border-subtle)', borderRadius: 4 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{artifact.runtimeResourceKey || artifact.runtimeResourceId || 'Unkeyed runtime artifact'}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', overflowWrap: 'anywhere' }}>
                          {artifact.projectId ? `Project ${artifact.projectId}` : 'No project lineage'} | {artifact.fileId ? `File ${artifact.fileId}` : 'No file lineage'}{artifact.runtimeTenantId ? ` | Tenant ${artifact.runtimeTenantId}` : ''}
                        </div>
                      </div>
                      <Tag type={artifact.artifactKind === 'process' ? 'blue' : artifact.artifactKind === 'decision' ? 'purple' : 'gray'} size="sm">{artifact.artifactKind} v{artifact.runtimeResourceVersion}</Tag>
                    </div>)}
                  </div>
                )}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--spacing-4)', display: 'grid', gap: 'var(--spacing-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>Pipeline receipts</h4>
          <Tag type="purple" size="sm">{receipts.length} recorded</Tag>
        </div>
        {receiptsLoading ? <InlineLoading description="Loading deployment receipts" /> : receiptsError ? (
          <InlineNotification lowContrast kind="error" title="Failed to load deployment receipts" subtitle={getUiErrorMessage(receiptsError, 'Failed to load deployment receipts')} hideCloseButton />
        ) : receipts.length === 0 ? (
          <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>No direct-pipeline receipts have been recorded for this engine.</div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
            {receipts.map((receipt) => (
              <div key={receipt.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--spacing-3)', alignItems: 'start', padding: 'var(--spacing-3)', border: '1px solid var(--color-border-subtle)', borderRadius: 6, background: 'var(--color-bg-primary)' }}>
                <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{receipt.lineage.deploymentName || receipt.engineDeploymentId}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', overflowWrap: 'anywhere' }}>
                    Project {receipt.projectId}{receipt.lineage.pipelineRunId ? ` | Run ${receipt.lineage.pipelineRunId}` : ''}{receipt.lineage.commitSha ? ` | ${receipt.lineage.commitSha.slice(0, 12)}` : ''}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Received {formatEngineTimestamp(receipt.receivedAt)}</div>
                </div>
                <Tag type="purple" size="sm">{formatEngineRegistrationStatus(receipt.source)}</Tag>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function EngineRuntimeResourcesSection({ resources, loading, error }: { resources: Array<{ id: string; resourceKind: string; resourceKey: string; runtimeTenantId?: string | null; source: string; observedAt: number }>; loading: boolean; error: unknown }) {
  const processes = resources.filter((resource) => resource.resourceKind === 'process_definition').length
  const decisions = resources.filter((resource) => resource.resourceKind === 'decision_definition').length
  return <section aria-label="Runtime resources" style={{ border: '1px solid var(--color-border-primary)', borderRadius: 8, padding: 'var(--spacing-4)', background: 'var(--color-bg-secondary)', display: 'grid', gap: 'var(--spacing-3)' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}><h3 style={{ margin: 0, fontSize: 16 }}>Runtime resources</h3><div style={{ display: 'flex', gap: 'var(--spacing-2)' }}><Tag type="blue" size="sm">{processes} processes</Tag><Tag type="purple" size="sm">{decisions} decisions</Tag></div></div>
    {loading ? <InlineLoading description="Loading runtime resources" /> : error ? <InlineNotification lowContrast kind="error" title="Runtime resources could not be loaded" subtitle={getUiErrorMessage(error, 'Request failed')} hideCloseButton /> : resources.length === 0 ? <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>No runtime resources have been recorded for this resource-aware engine.</div> : <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>{resources.slice(0, 8).map((resource) => <div key={resource.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-3)', padding: 'var(--spacing-2) 0', borderBottom: '1px solid var(--color-border-subtle)' }}><div style={{ minWidth: 0 }}><div style={{ overflowWrap: 'anywhere', fontSize: 13 }}>{resource.resourceKey}</div><div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{resource.runtimeTenantId || 'No runtime tenant'} | {resource.source}</div></div><Tag type={resource.resourceKind === 'process_definition' ? 'blue' : 'purple'} size="sm">{resource.resourceKind === 'process_definition' ? 'Process' : 'Decision'}</Tag></div>)}{resources.length > 8 && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Additional inventory is available in Access Control.</div>}</div>}
  </section>
}

function EngineRuntimeAccessSection({
  resources,
  resourcesError,
  resourcesLoading,
  resourceSets,
  resourceSetsError,
  resourceSetsLoading,
  assignments,
  assignmentsError,
  assignmentsLoading,
  canViewAssignments,
}: {
  resources: RuntimeResourceAccessInventory[]
  resourcesError: unknown
  resourcesLoading: boolean
  resourceSets: RuntimeResourceSetAccessInventory[]
  resourceSetsError: unknown
  resourceSetsLoading: boolean
  assignments: EngineRoleAssignment[]
  assignmentsError: unknown
  assignmentsLoading: boolean
  canViewAssignments: boolean
}) {
  const resourceById = React.useMemo(() => new Map(resources.map((resource) => [resource.id, resource])), [resources])
  const resourceSetById = React.useMemo(() => new Map(resourceSets.map((set) => [set.id, set])), [resourceSets])
  const targetForAssignment = (assignment: EngineRoleAssignment): string => {
    const scopeType = assignment.scopeType || assignment.resourceType
    const scopeId = assignment.scopeId || assignment.resourceId
    if (scopeType === 'engine_runtime_resource') {
      const resource = scopeId ? resourceById.get(scopeId) : null
      return resource ? `${resource.resourceKind === 'process_definition' ? 'Process' : 'Decision'}: ${resource.resourceKey}` : 'Runtime resource (inactive or removed)'
    }
    if (scopeType === 'engine_runtime_resource_set') {
      const set = scopeId ? resourceSetById.get(scopeId) : null
      return set ? `Resource set: ${set.name} (${set.key})` : 'Runtime resource set (archived or removed)'
    }
    return 'Runtime access target unavailable'
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-3)', borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--spacing-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>Runtime resource access</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Sanitized inventory, resource-set selectors, and grant lineage for this resource-aware engine.</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
          <Tag type="blue" size="sm">{resources.length} resources</Tag>
          <Tag type="purple" size="sm">{resourceSets.length} sets</Tag>
          {canViewAssignments && <Tag type="cyan" size="sm">{assignments.length} direct grants</Tag>}
        </div>
      </div>

      {resourcesLoading || resourceSetsLoading ? <InlineLoading description="Loading runtime access inventory" /> : resourcesError || resourceSetsError ? (
        <InlineNotification lowContrast kind="error" title="Runtime access inventory could not be loaded" subtitle={getUiErrorMessage(resourcesError || resourceSetsError, 'Request failed')} hideCloseButton />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>Runtime resources</div>
            {resources.length === 0 ? <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>No runtime resources have been recorded.</div> : resources.slice(0, 8).map((resource) => (
              <div key={resource.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--spacing-3)', alignItems: 'start', borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--spacing-2)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{resource.resourceKey}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', overflowWrap: 'anywhere' }}>Tenant: {resource.runtimeTenantId || 'none'} · Source: {resource.source}{resource.sourceRef ? ` (${resource.sourceRef})` : ''}</div>
                </div>
                <Tag type={resource.resourceKind === 'process_definition' ? 'blue' : 'purple'} size="sm">{resource.resourceKind === 'process_definition' ? 'Process' : 'Decision'}</Tag>
              </div>
            ))}
            {resources.length > 8 && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>+{resources.length - 8} additional runtime resources</div>}
          </div>

          <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>Resource sets</div>
            {resourceSets.length === 0 ? <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>No runtime resource sets are configured.</div> : resourceSets.slice(0, 8).map((set) => (
              <div key={set.id} style={{ display: 'grid', gap: 4, borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--spacing-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{set.name} <span style={{ color: 'var(--color-text-secondary)' }}>({set.key})</span></div>
                  <Tag type={set.resourceKind === 'process_definition' ? 'blue' : 'purple'} size="sm">{set.resourceKind === 'process_definition' ? 'Process' : 'Decision'}</Tag>
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', overflowWrap: 'anywhere' }}>Source: {set.source}{set.sourceRef ? ` (${set.sourceRef})` : ''}{set.selectorJson ? ` · Selector: ${set.selectorJson}` : ''}</div>
              </div>
            ))}
            {resourceSets.length > 8 && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>+{resourceSets.length - 8} additional resource sets</div>}
          </div>

          {!canViewAssignments ? <InlineNotification lowContrast kind="info" title="Exact runtime grants unavailable" subtitle="Viewing direct runtime-resource grants requires authorization-assignment read permission." hideCloseButton /> : assignmentsLoading ? <InlineLoading description="Loading exact runtime grants" /> : assignmentsError ? <InlineNotification lowContrast kind="error" title="Exact runtime grants could not be loaded" subtitle={getUiErrorMessage(assignmentsError, 'Request failed')} hideCloseButton /> : (
            <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>Exact grants</div>
              {assignments.length === 0 ? <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>No direct runtime-resource or resource-set grants are configured.</div> : assignments.slice(0, 8).map((assignment) => (
                <div key={assignment.id} style={{ display: 'grid', gap: 4, borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--spacing-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{formatEngineAccessPrincipal(assignment)}</div>
                    <Tag type={assignment.source === 'manual' ? 'blue' : assignment.source === 'sso' ? 'purple' : 'gray'} size="sm">{formatEngineRegistrationStatus(assignment.source)}</Tag>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--spacing-3)' }}>
                    <EngineRegistrationDetail label="Role" value={assignment.roleName || formatEngineAccessRole(assignment.roleId)} />
                    <EngineRegistrationDetail label="Target" value={targetForAssignment(assignment)} />
                    <EngineRegistrationDetail label="Lineage" value={formatEngineAccessSourceLineage(assignment)} />
                    <EngineRegistrationDetail label="Expires" value={formatEngineTimestamp(assignment.expiresAt)} />
                  </div>
                </div>
              ))}
              {assignments.length > 8 && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>+{assignments.length - 8} additional direct grants</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EngineAccessSection({
  assignments,
  assignmentsError,
  assignmentsLoading,
  canViewMembers,
  membersError,
  membersLoading,
  membersResponse,
  canViewRuntimeResources,
  runtimeResources,
  runtimeResourcesError,
  runtimeResourcesLoading,
  runtimeResourceSets,
  runtimeResourceSetsError,
  runtimeResourceSetsLoading,
  runtimeAssignments,
  runtimeAssignmentsError,
  runtimeAssignmentsLoading,
  canViewRuntimeAssignments,
}: {
  assignments: EngineRoleAssignment[]
  assignmentsError: unknown
  assignmentsLoading: boolean
  canViewMembers: boolean
  membersError: unknown
  membersLoading: boolean
  membersResponse: EngineMembersResponse | undefined
  canViewRuntimeResources: boolean
  runtimeResources: RuntimeResourceAccessInventory[]
  runtimeResourcesError: unknown
  runtimeResourcesLoading: boolean
  runtimeResourceSets: RuntimeResourceSetAccessInventory[]
  runtimeResourceSetsError: unknown
  runtimeResourceSetsLoading: boolean
  runtimeAssignments: EngineRoleAssignment[]
  runtimeAssignmentsError: unknown
  runtimeAssignmentsLoading: boolean
  canViewRuntimeAssignments: boolean
}) {
  const members = Array.isArray(membersResponse?.members) ? membersResponse!.members! : []
  const pendingInvites = Array.isArray(membersResponse?.pendingInvites) ? membersResponse!.pendingInvites! : []
  const governanceAssignments = assignments.filter(isEngineGovernanceRoleAssignment)
  const scopedAccessAssignments = assignments.filter((assignment) => !isEngineGovernanceRoleAssignment(assignment))
  const accountableOwnerLabels = getEngineAccountableOwnerLabels(members)
  const effectiveOwnerLabels = getEngineEffectiveOwnerLabels(members, assignments)

  return (
    <section
      aria-label="Access"
      style={{
        border: '1px solid var(--color-border-primary)',
        borderRadius: 8,
        padding: 'var(--spacing-4)',
        background: 'var(--color-bg-secondary)',
        display: 'grid',
        gap: 'var(--spacing-4)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>Access</h3>
        {canViewMembers && (
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
            <Tag type="blue" size="sm">{members.length} people</Tag>
            <Tag type="magenta" size="sm">{governanceAssignments.length} governance</Tag>
            <Tag type="cyan" size="sm">{scopedAccessAssignments.length} assignments</Tag>
          </div>
        )}
      </div>

      {!canViewMembers ? (
        <InlineNotification
          lowContrast
          kind="info"
          title="Access details unavailable"
          subtitle="Viewing engine access requires engine member visibility permission."
          hideCloseButton
        />
      ) : membersLoading || assignmentsLoading ? (
        <InlineLoading description="Loading access details" />
      ) : membersError || assignmentsError ? (
        <InlineNotification
          lowContrast
          kind="error"
          title="Failed to load access details"
          subtitle={getUiErrorMessage(membersError || assignmentsError, 'Failed to load access details')}
          hideCloseButton
        />
      ) : members.length === 0 && governanceAssignments.length === 0 && scopedAccessAssignments.length === 0 && pendingInvites.length === 0 ? (
        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
          No engine access entries are configured.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--spacing-3)' }}>
            <EngineRegistrationDetail
              label="Accountable owner"
              value={accountableOwnerLabels.length > 0 ? accountableOwnerLabels.join(', ') : 'Not assigned'}
            />
            <EngineRegistrationDetail
              label="Effective owners"
              value={effectiveOwnerLabels.length > 0 ? effectiveOwnerLabels.join(', ') : 'None'}
            />
          </div>

          {members.length > 0 && (
            <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}>People</div>
              <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                {members.slice(0, 6).map((member) => (
                  <div key={member.id || member.userId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '13px', color: 'var(--color-text-primary)', overflowWrap: 'anywhere' }}>{formatEngineAccessMemberName(member)}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', overflowWrap: 'anywhere' }}>
                        {member.user?.email || member.userId} · {formatEngineAccessMemberGovernance(member)}
                      </div>
                    </div>
                    <Tag type={getRegistrationTagType(member.role)} size="sm">{formatEngineAccessRole(member.role)}</Tag>
                  </div>
                ))}
                {members.length > 6 && (
                  <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>+{members.length - 6} more people</div>
                )}
              </div>
            </div>
          )}

          {governanceAssignments.length > 0 && (
            <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}>Governance grants</div>
              <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                {governanceAssignments.slice(0, 6).map((assignment) => (
                  <div key={assignment.id} style={{ display: 'grid', gap: 'var(--spacing-2)', borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--spacing-2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '13px', color: 'var(--color-text-primary)', overflowWrap: 'anywhere' }}>{formatEngineAccessPrincipal(assignment)}</div>
                      <Tag type="magenta" size="sm">Managed governance</Tag>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--spacing-3)' }}>
                      <EngineRegistrationDetail label="Role" value={assignment.roleName || formatEngineAccessRole(assignment.roleId)} />
                      <EngineRegistrationDetail label="Source" value={formatEngineRegistrationStatus(assignment.source)} />
                      <EngineRegistrationDetail label="Lineage" value={formatEngineAccessSourceLineage(assignment)} />
                      <EngineRegistrationDetail label="Expires" value={formatEngineTimestamp(assignment.expiresAt)} />
                    </div>
                  </div>
                ))}
                {governanceAssignments.length > 6 && (
                  <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>+{governanceAssignments.length - 6} more governance grants</div>
                )}
              </div>
            </div>
          )}

          {scopedAccessAssignments.length > 0 && (
            <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}>Scoped assignments</div>
              <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                {scopedAccessAssignments.slice(0, 6).map((assignment) => (
                  <div key={assignment.id} style={{ display: 'grid', gap: 'var(--spacing-2)', borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--spacing-2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '13px', color: 'var(--color-text-primary)', overflowWrap: 'anywhere' }}>{formatEngineAccessPrincipal(assignment)}</div>
                      <Tag type={assignment.source === 'manual' ? 'blue' : assignment.source === 'sso' ? 'purple' : 'gray'} size="sm">{formatEngineRegistrationStatus(assignment.source)}</Tag>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--spacing-3)' }}>
                      <EngineRegistrationDetail label="Role" value={assignment.roleName || formatEngineAccessRole(assignment.roleId)} />
                      <EngineRegistrationDetail label="Principal" value={assignment.principalType || 'user'} />
                      <EngineRegistrationDetail label="Lineage" value={formatEngineAccessSourceLineage(assignment)} />
                      <EngineRegistrationDetail label="Expires" value={formatEngineTimestamp(assignment.expiresAt)} />
                    </div>
                  </div>
                ))}
                {scopedAccessAssignments.length > 6 && (
                  <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>+{scopedAccessAssignments.length - 6} more assignments</div>
                )}
              </div>
            </div>
          )}


          {pendingInvites.length > 0 && (
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
              {pendingInvites.length} pending invite{pendingInvites.length === 1 ? '' : 's'} also {pendingInvites.length === 1 ? 'exists' : 'exist'} for this engine.
            </div>
          )}
        </div>
      )}

      {canViewRuntimeResources && (
        <EngineRuntimeAccessSection
          resources={runtimeResources}
          resourcesError={runtimeResourcesError}
          resourcesLoading={runtimeResourcesLoading}
          resourceSets={runtimeResourceSets}
          resourceSetsError={runtimeResourceSetsError}
          resourceSetsLoading={runtimeResourceSetsLoading}
          assignments={runtimeAssignments}
          assignmentsError={runtimeAssignmentsError}
          assignmentsLoading={runtimeAssignmentsLoading}
          canViewAssignments={canViewRuntimeAssignments}
        />
      )}
    </section>
  )
}

function EngineRegistrationSection({ engine }: { engine: EngineInventory }) {
  if (!engine) return null
  return (
    <section
      aria-label="Registration"
      style={{
        border: '1px solid var(--color-border-primary)',
        borderRadius: 8,
        padding: 'var(--spacing-4)',
        background: 'var(--color-bg-secondary)',
        display: 'grid',
        gap: 'var(--spacing-4)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>Registration</h3>
        <Tag type={getRegistrationTagType(engine.registrationSource)} size="sm">{formatEngineRegistrationSource(engine)}</Tag>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--spacing-4)' }}>
        <EngineRegistrationDetail label="External system" value={engine.externalSystemId || '-'} />
        <EngineRegistrationDetail label="External ID" value={engine.externalId || '-'} />
        <EngineRegistrationDetail label="Config key" value={engine.configKey || '-'} />
        <EngineRegistrationDetail label="Configuration ownership" value={engine.ownershipMode ? formatEngineRegistrationStatus(engine.ownershipMode) : '-'} />
        <EngineRegistrationDetail label="Last configuration apply" value={formatEngineTimestamp(engine.lastAppliedAt)} />
        <EngineRegistrationDetail label="Management mode" value={formatEngineRegistrationStatus(engine.managementMode)} tagValue={engine.managementMode || undefined} />
        <EngineRegistrationDetail label="Who can use this engine" value={engine.tenancyMode === 'shared' ? 'Multiple tenants' : 'One tenant'} tagValue={engine.tenancyMode || 'dedicated'} />
        <EngineRegistrationDetail label="Tenant owner" value={engine.tenantId || (engine.tenancyMode === 'shared' ? 'Set per runtime resource' : '-')} />
        <EngineRegistrationDetail label="How resources map to tenants" value={formatEngineRegistrationStatus(engine.tenantMappingStrategy)} />
        <EngineRegistrationDetail label="Tenant mapping version" value={String(engine.tenantMappingVersion || 0)} />
        <EngineRegistrationDetail label="Tenant resolution" value={formatEngineRegistrationStatus(engine.tenantResolutionStatus)} tagValue={engine.tenantResolutionStatus || undefined} />
        <EngineRegistrationDetail label="Last tenant reconciliation" value={formatEngineTimestamp(engine.lastTenantReconciledAt)} />
        <EngineRegistrationDetail label="How access is granted" value={engine.runtimeAccessScope === 'resource_aware' ? 'Selected runtime resources' : 'Whole engine'} />
        <EngineRegistrationDetail label="How EnterpriseGlue connects" value={engine.connectionMode === 'customer_sidecar' ? 'Customer gateway or sidecar' : 'Directly to the engine'} />
        <EngineRegistrationDetail label="How EnterpriseGlue authenticates" value={formatEngineAuthentication(engine)} />
        <EngineRegistrationDetail label="How deployments reach the engine" value={engine.deploymentIntegration === 'direct_engine' ? 'External pipeline' : 'Through EnterpriseGlue'} />
        <EngineRegistrationDetail label="Runtime metadata discovery" value={engine.metadataDiscoveryEnabled === false ? 'Disabled' : 'Enabled'} />
        <EngineRegistrationDetail label="Deployment discovery" value={engine.deploymentDiscoveryEnabled === false ? 'Disabled' : 'Enabled'} />
        <EngineRegistrationDetail label="Discovery cadence" value={`${engine.reconciliationIntervalSeconds || 300} seconds`} />
        <EngineRegistrationDetail label="Last discovery" value={formatEngineTimestamp(engine.lastMetadataReconciledAt)} />
        <EngineRegistrationDetail label="Discovery status" value={formatEngineRegistrationStatus(engine.lastMetadataReconciliationStatus)} tagValue={engine.lastMetadataReconciliationStatus || undefined} />
        <EngineRegistrationDetail label="Pipeline receipts" value={engine.pipelineReceiptEnabled === false ? 'Disabled' : 'Enabled'} />
        <EngineRegistrationDetail label="Lifecycle" value={formatEngineRegistrationStatus(engine.lifecycleStatus || 'active')} tagValue={engine.lifecycleStatus || 'active'} />
        <EngineRegistrationDetail label="Drift" value={formatEngineRegistrationStatus(engine.driftStatus)} tagValue={engine.driftStatus || undefined} />
        <EngineRegistrationDetail label="Capability status" value={formatEngineRegistrationStatus(engine.capabilityStatus)} tagValue={engine.capabilityStatus || undefined} />
        <EngineRegistrationDetail label="Last external sync" value={formatEngineTimestamp(engine.lastExternalSyncAt)} />
        <EngineRegistrationDetail label="External updated" value={formatEngineTimestamp(engine.externalUpdatedAt)} />
      </div>
      <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
        <EngineRegistrationDetail label="Labels" value={formatEngineLabels(engine.labels)} />
        <EngineRegistrationDetail label="Field ownership" value={formatEngineFieldOwnership(engine.fieldOwnership)} />
        <EngineRegistrationDetail label="Expected capabilities" value={formatEngineCapabilitySummary(engine.capabilities)} />
        <EngineRegistrationDetail label="Reported capabilities" value={formatEngineCapabilitySummary(engine.reportedCapabilities)} />
        <EngineRegistrationDetail label="Capability diagnostics" value={formatEngineCapabilityDiagnostics(engine.capabilityDiagnostics)} />
      </div>
    </section>
  )
}

export function buildEngineMutationPayload(
  form: EngineMutationForm,
  editing: null | undefined,
  options?: { canManageSecrets?: boolean }
): CreateEngineRequest
export function buildEngineMutationPayload(
  form: EngineMutationForm,
  editing: EngineInventoryPresentation & { hasCredential?: boolean },
  options?: { canManageSecrets?: boolean }
): UpdateEngineRequest
export function buildEngineMutationPayload(
  form: EngineMutationForm,
  editing?: (EngineInventoryPresentation & { hasCredential?: boolean }) | null,
  options: { canManageSecrets?: boolean } = {}
): EngineMutationPayload {
  if (editing && isExternallyManagedEngine(editing)) {
    return {
      name: form.name,
      environmentTagId: form.environmentTagId || null,
    }
  }

  const {
    tenancyMode,
    tenantMappingStrategy,
    ...registrationForm
  } = form
  const payload: EngineMutationPayload = {
    ...registrationForm,
    ...(!editing ? {
      tenancy: tenancyMode === 'shared'
        ? { mode: 'shared' as const, mappingStrategy: tenantMappingStrategy, unmappedPolicy: 'deny' as const }
        : { mode: 'dedicated' as const, tenantRef: { type: 'request_context' as const } },
      runtimeAccessScope: tenancyMode === 'shared' ? 'resource_aware' as const : registrationForm.runtimeAccessScope,
    } : {}),
  }
  if (editing && options.canManageSecrets === false) {
    for (const field of ENGINE_SECRET_FORM_FIELDS) {
      payload[field] = undefined
    }
    return payload
  }

  if (payload.authType === 'bearer') {
    // Bearer auth only uses token (stored in passwordEnc), not username.
    payload.username = undefined
  }
  if (payload.authType === 'none') {
    payload.username = undefined
    payload.passwordEnc = null
    payload.oauthTokenUrl = undefined
    payload.oauthScopes = undefined
    payload.oauthAudience = undefined
  }
  if (payload.authType !== 'oauth2-client-credentials') {
    payload.oauthTokenUrl = undefined
    payload.oauthScopes = undefined
    payload.oauthAudience = undefined
  }
  if (editing && payload.authType !== 'none' && !payload.passwordEnc) {
    // Engine credentials are write-only. Leaving the replacement field empty
    // preserves the stored credential instead of clearing it on an unrelated edit.
    payload.passwordEnc = undefined
  }
  return payload
}


export default function Engines() {
  const location = useLocation() as any
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { refreshUser, hasEnginePermission, permissions } = useAuth()
  const createEngineDecision = useActionDecision('engine.inventory.create', { type: 'platform' })
  const runtimeResourcesReadDecision = useActionDecision('platform.engine-sets.read', { type: 'platform' })
  const assignmentReadDecision = useActionDecision('platform.authz.assignments.read', { type: 'platform' })
  const platformSettingsQ = useQuery({
    queryKey: ['platform', 'sync-settings'],
    queryFn: () => apiClient.get<EngineOnboardingSettings>('/api/auth/platform-settings', undefined, { credentials: 'include' }),
  })
  const engineOnboardingMode = platformSettingsQ.data?.engineOnboardingMode || 'manual_allowed'
  const engineAccessAuthority = platformSettingsQ.data?.engineAccessAuthority || 'manual'
  const legacyManualEngineOnboardingAllowed = platformSettingsQ.data?.governanceBehavior?.manualEngineRegistrationAllowed
    ?? isManualEngineOnboardingAllowed(engineOnboardingMode)
  const hasServerPlatformActionAvailability = Boolean(permissions?.platformActionAvailability)
  const manualEngineOnboardingAllowed = hasServerPlatformActionAvailability
    ? createEngineDecision.allowed
    : legacyManualEngineOnboardingAllowed
  const canCreateEngine = createEngineDecision.allowed
    && manualEngineOnboardingAllowed
  const createEngineUnavailableReason = canCreateEngine || hasServerPlatformActionAvailability
    ? createEngineDecision.reason
    : 'Manual engine registration is disabled by the current onboarding policy.'
  const engineModal = useModal<EngineMutationForm>()
  const { notify } = useToast()
  const [editing, setEditing] = React.useState<EngineInventory | null>(null)
  const [form, setForm] = React.useState<EngineMutationForm>({
    name: '',
    baseUrl: '',
    type: 'ion',
    authType: 'basic',
    connectionMode: 'direct',
    username: '',
    passwordEnc: '',
    oauthTokenUrl: '',
    oauthScopes: '',
    oauthAudience: '',
    environmentTagId: '',
    tenancyMode: 'dedicated',
    tenantMappingStrategy: 'engine_tenant_id',
    runtimeAccessScope: 'engine_wide' as RuntimeAccessScope,
    deploymentIntegration: 'enterpriseglue_proxy' as DeploymentIntegration,
    metadataDiscoveryEnabled: true,
    deploymentDiscoveryEnabled: true,
    reconciliationIntervalSeconds: 300,
    pipelineReceiptEnabled: true,
  })
  const [searchQuery, setSearchQuery] = React.useState('')
  const [metadataFilterId, setMetadataFilterId] = React.useState('')

  // Engine members panel state
  const [membersOpen, setMembersOpen] = React.useState(false)
  const [selectedEngine, setSelectedEngine] = React.useState<EngineInventory | null>(null)

  const dockerLoopbackSuggestion = React.useMemo(() => getDockerLoopbackSuggestion(String(form.baseUrl || '').trim()), [form.baseUrl])

  // Fetch environment tags (read-only, used by engine owners/delegates too)
  const envTagsQ = useQuery({ queryKey: ['engines', 'environment-tags'], queryFn: getEngineEnvironmentTags })
  const envTags = envTagsQ.data
  const hasSingleTag = Array.isArray(envTags) && envTags.length === 1
  const hasMultipleTags = Array.isArray(envTags) && envTags.length > 1

  const listQ = useQuery({ queryKey: ['engines'], queryFn: getManageableEngines })
  const areSourceOwnedFieldsReadOnly = Boolean(editing && (isExternallyManagedEngine(editing) || isConfigLockedEngine(editing)))

  const createM = useMutation({
    mutationFn: createEngine,
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['engines'] })
      qc.invalidateQueries({ queryKey: ['engines','active'] })
      qc.invalidateQueries({ queryKey: ['engines-selector'] })
      try {
        await refreshUser()
      } catch {
        // Non-blocking: engine creation succeeded even if capability refresh fails.
      }
      engineModal.closeModal()
      notify({ kind: 'success', title: 'Engine created' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to create engine', subtitle: getUiErrorMessage(e, 'Failed to create') })
  })
  const updateM = useMutation({
    mutationFn: (payload: UpdateEngineRequest) => {
      if (!editing) throw new Error('Select an engine before updating it')
      return updateEngine(editing.id, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engines'] })
      qc.invalidateQueries({ queryKey: ['engines','active'] })
      engineModal.closeModal()
      setEditing(null)
      notify({ kind: 'success', title: 'Engine updated' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to update engine', subtitle: getUiErrorMessage(e, 'Failed to update') })
  })
  const setEnvironmentM = useMutation({
    mutationFn: ({ engineId, environmentTagId }: { engineId: string; environmentTagId: string | null }) => setEngineEnvironment(engineId, environmentTagId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engines'] })
      qc.invalidateQueries({ queryKey: ['engines','active'] })
      engineModal.closeModal()
      setEditing(null)
      notify({ kind: 'success', title: 'Engine environment updated' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to update engine environment', subtitle: getUiErrorMessage(e, 'Failed to update engine environment') })
  })
  const deleteM = useMutation({
    mutationFn: deleteEngineRequest,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engines'] })
      notify({ kind: 'success', title: 'Engine deleted' })
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to delete engine', subtitle: getUiErrorMessage(e, 'Failed to delete') })
  })
  const testM = useMutation({
    mutationFn: testEngineConnection,
    onSuccess: (_data, id) => { qc.invalidateQueries({ queryKey: ['engines'] }); qc.invalidateQueries({ queryKey: ['engines','health', id] }) },
    onError: (e: any) => notify({ kind: 'error', title: 'Failed to test connection', subtitle: getUiErrorMessage(e, 'Failed to test connection') })
  })

  const openNew = React.useCallback(() => {
    if (!canCreateEngine) return
    setEditing(null)
    // Auto-assign environment tag if there's only one
    const autoTagId = hasSingleTag ? envTags![0].id : ''
    setForm({
      name: '',
      baseUrl: '',
      type: 'ion',
      authType: 'basic',
      connectionMode: 'direct',
      username: '',
      passwordEnc: '',
      oauthTokenUrl: '',
      oauthScopes: '',
      oauthAudience: '',
      environmentTagId: autoTagId,
      tenancyMode: 'dedicated',
      tenantMappingStrategy: 'engine_tenant_id',
      runtimeAccessScope: 'engine_wide',
      deploymentIntegration: 'enterpriseglue_proxy',
      metadataDiscoveryEnabled: true,
      deploymentDiscoveryEnabled: true,
      reconciliationIntervalSeconds: 300,
      pipelineReceiptEnabled: true,
    })
    engineModal.openModal()
  }, [canCreateEngine, hasSingleTag, envTags, engineModal])

  const didHandleOpenNewEngine = React.useRef(false)
  React.useEffect(() => {
    if (didHandleOpenNewEngine.current) return
    if (!location?.state?.openNewEngine) return
    didHandleOpenNewEngine.current = true
    openNew()
    navigate(safeRelativePath(`${location.pathname || ''}${location.search || ''}`), { replace: true, state: {} })
  }, [location, navigate, openNew])

  const rows = listQ.data || []
  const [isAddFirstEngineHover, setIsAddFirstEngineHover] = React.useState(false)

  const hasEngineAction = React.useCallback((engineId: string | null | undefined, actionId: string) => {
    return evaluateActionSnapshot(permissions, actionId, { type: 'engine', id: engineId }).allowed
  }, [permissions])

  function getActionsForEngine(engine: EngineActionSubject) {
    const useServerActionAvailability = Boolean(
      engine?.id && permissions?.engines.find((item) => item.resourceId === engine.id)?.actionAvailability,
    )
    return getEngineActionPermissions(engine, hasEnginePermission, hasEngineAction, useServerActionAvailability)
  }

  const editingActions = editing ? getActionsForEngine(editing) : null
  const isConfigLocked = Boolean(editing && isConfigLockedEngine(editing))
  const isEngineEnvironmentOnlyEditable = Boolean(editing && !editingActions?.canEdit && editingActions?.canSetEnvironment)
  const isEngineFormReadOnly = Boolean(editing && (isConfigLocked || (!editingActions?.canEdit && !editingActions?.canSetEnvironment)))
  const canViewEditingProjectAccess = editing ? Boolean(editingActions?.canViewProjectAccess) : false
  const canViewEditingDeployments = editing ? Boolean(editingActions?.canViewDeployments) : false
  const canViewEditingSecrets = editing ? Boolean(editingActions?.canViewSecrets) : true
  const canManageEditingSecrets = editing ? Boolean(editingActions?.canManageSecrets) : true
  const canSetEditingEnvironment = editing ? Boolean(editingActions?.canSetEnvironment || editingActions?.canEdit) : true
  const areAuthFieldsReadOnly = areSourceOwnedFieldsReadOnly || Boolean(editing && !canManageEditingSecrets)
  const isOAuth2ClientCredentialsIncomplete = isOAuth2ClientCredentialsFormIncomplete(form, editing)
  const isCredentiallessEndpointInvalid = form.authType === 'none'
    && (form.connectionMode !== 'customer_sidecar' || platformSettingsQ.data?.credentiallessCustomerSidecarsEnabled !== true)
  const deploymentTargetsQ = useQuery({
    queryKey: ['engines', editing?.id, 'project-targets'],
    enabled: Boolean(engineModal.isOpen && editing?.id && canViewEditingProjectAccess),
    queryFn: () => getEngineProjectTargets(String(editing!.id)),
  })
  const deploymentReceiptsQ = useQuery({
    queryKey: ['engines', editing?.id, 'deployment-receipts'],
    enabled: Boolean(engineModal.isOpen && editing?.id && canViewEditingDeployments),
    queryFn: () => getEngineDeploymentReceipts(String(editing!.id)),
  })
  const deploymentHistoryQ = useQuery({
    queryKey: ['engines', editing?.id, 'deployment-history'],
    enabled: Boolean(engineModal.isOpen && editing?.id && canViewEditingDeployments),
    queryFn: () => getEngineDeploymentHistory(String(editing!.id)),
  })
  const [selectedDeploymentLineageId, setSelectedDeploymentLineageId] = React.useState<string | null>(null)
  const deploymentLineageQ = useQuery({
    queryKey: ['engines', editing?.id, 'deployment-lineage', selectedDeploymentLineageId],
    enabled: Boolean(engineModal.isOpen && editing?.id && canViewEditingDeployments && selectedDeploymentLineageId),
    queryFn: () => getEngineDeploymentLineage(String(editing!.id), String(selectedDeploymentLineageId)),
  })
  const runtimeResourcesQ = useRuntimeResources(editing?.id ? String(editing.id) : undefined, {
    includeInactive: true,
    enabled: Boolean(engineModal.isOpen && editing?.id && editing?.runtimeAccessScope === 'resource_aware' && runtimeResourcesReadDecision.allowed),
  })
  const runtimeResourceSetsQ = useRuntimeResourceSets(editing?.id ? String(editing.id) : undefined, {
    includeArchived: true,
    enabled: Boolean(engineModal.isOpen && editing?.id && editing?.runtimeAccessScope === 'resource_aware' && runtimeResourcesReadDecision.allowed),
  })
  const runtimeAssignmentsQ = useQuery({
    queryKey: ['engines', editing?.id, 'runtime-role-assignments'],
    enabled: Boolean(engineModal.isOpen && editing?.id && editing?.runtimeAccessScope === 'resource_aware' && runtimeResourcesReadDecision.allowed && assignmentReadDecision.allowed),
    queryFn: () => fetchList<EngineRoleAssignment>('/api/authz/role-assignments', { engineId: String(editing?.id) }, { credentials: 'include' }),
  })
  const accessMembersQ = useQuery({
    queryKey: ['engines', editing?.id, 'access-members'],
    enabled: Boolean(engineModal.isOpen && editing?.id && editingActions?.canViewMembers),
    queryFn: () => getEngineMembers(String(editing!.id)),
  })
  const accessAssignmentsQ = useQuery({
    queryKey: ['engines', editing?.id, 'access-assignments'],
    enabled: Boolean(engineModal.isOpen && editing?.id && editingActions?.canViewMembers),
    queryFn: () => fetchList<EngineRoleAssignment>(
      `/api/authz/role-assignments?resourceType=engine&resourceId=${encodeURIComponent(String(editing?.id))}`,
      undefined,
      { credentials: 'include' }
    ),
  })
  const engineDetailSections = React.useMemo(() => resolveEngineDetailSections({
    isEditing: Boolean(editing),
    canViewMembers: Boolean(editingActions?.canViewMembers),
    canViewProjectAccess: canViewEditingProjectAccess,
    canViewDeployments: canViewEditingDeployments,
    canViewRuntimeResources: Boolean(editing?.runtimeAccessScope === 'resource_aware' && runtimeResourcesReadDecision.allowed),
  }), [canViewEditingDeployments, canViewEditingProjectAccess, editing, editingActions?.canViewMembers, runtimeResourcesReadDecision.allowed])

  function openEngineDetails(row: EngineInventory) {
    if (!row?.id) return
    const actions = getActionsForEngine(row)
    if (!actions.canEdit && !getEngineInventoryReadDecision(row, permissions).allowed) return
    setEditing(row)
    setForm({
      name: row.name || '',
      baseUrl: row.baseUrl || '',
      type: normalizeEngineType(row.type),
      authType: row.authType || 'basic',
      connectionMode: row.connectionMode === 'customer_sidecar' ? 'customer_sidecar' : 'direct',
      username: row.username || '',
      passwordEnc: '',
      oauthTokenUrl: row.oauthTokenUrl || '',
      oauthScopes: row.oauthScopes || '',
      oauthAudience: row.oauthAudience || '',
      environmentTagId: row.environmentTagId || '',
      tenancyMode: row.tenancyMode === 'shared' ? 'shared' : 'dedicated',
      tenantMappingStrategy: row.tenantMappingStrategy || 'engine_tenant_id',
      runtimeAccessScope: row.runtimeAccessScope === 'resource_aware' ? 'resource_aware' : 'engine_wide',
      deploymentIntegration: row.deploymentIntegration === 'direct_engine' ? 'direct_engine' : 'enterpriseglue_proxy',
      metadataDiscoveryEnabled: row.metadataDiscoveryEnabled !== false,
      deploymentDiscoveryEnabled: row.deploymentDiscoveryEnabled !== false,
      reconciliationIntervalSeconds: row.reconciliationIntervalSeconds || 300,
      pipelineReceiptEnabled: row.pipelineReceiptEnabled !== false,
    })
    engineModal.openModal()
  }

  function openEdit(row: EngineInventory) {
    if (!getActionsForEngine(row).canEdit) return
    openEngineDetails(row)
  }

  function openMembersPanel(engine: EngineInventory) {
    const permissions = getActionsForEngine(engine)
    if (!permissions.canOpenMembers) return
    setSelectedEngine(engine)
    setMembersOpen(true)
  }

  function testEngine(engine: EngineInventory | null | undefined) {
    if (!engine || !getActionsForEngine(engine).canTest) return
    testM.mutate(engine.id)
  }

  function deleteEngine(engine: EngineInventory | null | undefined) {
    if (!engine || !manualEngineOnboardingAllowed || !getActionsForEngine(engine).canDelete) return
    deleteM.mutate(engine.id)
  }

  function closeMembersPanel() {
    setMembersOpen(false)
    setSelectedEngine(null)
  }

  const tableHeaders = React.useMemo(
    () => [
      { key: 'name', header: 'Name' },
      { key: 'baseUrl', header: 'Endpoint URL' },
      { key: 'type', header: 'Type' },
      { key: 'environment', header: 'Environment' },
      { key: 'health', header: 'Health' },
      { key: 'version', header: 'Version' },
      { key: 'actions', header: 'Actions' },
    ],
    []
  )

  const metadataFilterOptions = React.useMemo(() => [
    { id: '', label: 'All metadata' },
    ...getEngineMetadataFilterOptions(rows),
  ], [rows])

  const visibleEngines = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return rows.filter((e) => {
      const envTagName = Array.isArray(envTags)
        ? (envTags.find((t) => t.id === e.environmentTagId)?.name || '')
        : ''
      const hay = [
        String(e?.name || ''),
        String(e?.baseUrl || ''),
        String(e?.type || ''),
        String(envTagName || ''),
        formatEngineLabels(e?.labels),
      ]
        .join(' ')
        .toLowerCase()
      return (!q || hay.includes(q)) && matchesEngineMetadataFilter(e, metadataFilterId)
    })
  }, [rows, searchQuery, metadataFilterId, envTags])
  const hasPlatformEngineCreatePermission = Boolean(
    permissions?.platform?.includes('platform:engine:create'),
  )

  return (
    <PageLayout style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)', background: 'var(--color-bg-primary)', minHeight: '100vh' }}>
      <PageHeader
        icon={Chip}
        title="Engines"
        subtitle="Manage workflow engine connections and monitor their health"
        gradient={PAGE_GRADIENTS.blue}
      />

      {/* Access Error State */}
      {listQ.isError && (() => {
        const accessErr = isEngineAccessError(listQ.error)
        if (accessErr) {
          return <EngineAccessError status={accessErr.status} message={accessErr.message} />
        }
        return (
          <InlineNotification
            lowContrast
            kind="error"
            title="Failed to load engines"
            subtitle={(listQ.error as any)?.message || 'Unknown error'}
          />
        )
      })()}

      {!listQ.isLoading && rows.length > 0 && !hasPlatformEngineCreatePermission && (
        <InlineNotification
          lowContrast
          kind="info"
          title="Showing your assigned engines"
          subtitle="Only engines granted to your account are listed. Engines outside your access scope are hidden."
          hideCloseButton
        />
      )}

      {/* Loading State */}
      {listQ.isLoading && (
        <TableContainer>
          <TableToolbar>
            <TableToolbarContent>
              <TableToolbarSearch
                persistent
                onChange={(e: any) => setSearchQuery(e.target.value)}
                value={searchQuery}
                placeholder="Search engines"
              />
              {manualEngineOnboardingAllowed && (
                <Button kind="primary" renderIcon={Add} onClick={openNew} disabled={!canCreateEngine} title={canCreateEngine ? undefined : createEngineUnavailableReason}>
                  Add engine
                </Button>
              )}
            </TableToolbarContent>
          </TableToolbar>
          <DataTableSkeleton
            showToolbar={false}
            showHeader
            headers={tableHeaders}
            rowCount={8}
            columnCount={tableHeaders.length}
          />
        </TableContainer>
      )}

      {/* Empty State */}
      {!listQ.isLoading && rows.length === 0 && (
        <div style={{
          background: 'var(--color-bg-secondary)',
          border: '2px dashed var(--color-border-primary)',
          borderRadius: '8px',
          padding: 'var(--spacing-8)',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--spacing-3)'
        }}>
          <Chip size={48} style={{ color: 'var(--color-text-tertiary)' }} />
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {manualEngineOnboardingAllowed ? 'No engines configured' : 'No engines registered'}
            </h3>
            <p style={{ margin: '8px 0 0 0', fontSize: '14px', color: 'var(--color-text-secondary)', maxWidth: '400px' }}>
              {manualEngineOnboardingAllowed
                ? 'Get started by adding your first workflow engine connection'
                : 'Engines are registered by external systems for this platform.'}
            </p>
          </div>
          {manualEngineOnboardingAllowed && (
            <Button
              kind="secondary"
              size="md"
              style={isAddFirstEngineHover ? { backgroundColor: '#474747', cursor: 'pointer' } : undefined}
              onMouseEnter={() => setIsAddFirstEngineHover(true)}
              onMouseLeave={() => setIsAddFirstEngineHover(false)}
              renderIcon={Add}
              onClick={openNew}
              disabled={!canCreateEngine}
              title={canCreateEngine ? undefined : createEngineUnavailableReason}
            >
              Add your first engine
            </Button>
          )}
        </div>
      )}

      {/* Engines List */}
      {!listQ.isLoading && rows.length > 0 && (
        <TableContainer>
          <DataTable
            rows={visibleEngines.map((e) => {
              const envTag = Array.isArray(envTags) ? envTags.find((t) => t.id === e.environmentTagId) : null
              return {
                id: e.id,
                name: e.name || '—',
                baseUrl: e.baseUrl || '—',
                type: ENGINE_TYPE_LABELS[normalizeEngineType(e.type)],
                environment: envTag?.name || '—',
                health: '',
                version: '',
                actions: '',
              }
            })}
            headers={tableHeaders}
          >
            {({ rows: tableRows, headers, getHeaderProps, getRowProps, getTableProps, getToolbarProps }) => (
              <>
                <TableToolbar {...getToolbarProps()}>
                  <TableToolbarContent>
                    <TableToolbarSearch
                      persistent
                      onChange={(e: any) => setSearchQuery(e.target.value)}
                      value={searchQuery}
                      placeholder="Search engines"
                    />
                    <Dropdown
                      id="engine-metadata-filter"
                      aria-label="Filter by engine metadata"
                      titleText="Metadata"
                      label="All metadata"
                      items={metadataFilterOptions}
                      itemToString={(item: EngineMetadataFilterOption | null) => item?.label || ''}
                      selectedItem={metadataFilterOptions.find((item) => item.id === metadataFilterId) || null}
                      onChange={({ selectedItem }: { selectedItem?: EngineMetadataFilterOption | null }) => setMetadataFilterId(selectedItem?.id || '')}
                      disabled={metadataFilterOptions.length === 1}
                      title={metadataFilterOptions.length === 1 ? 'No engine metadata labels are available' : undefined}
                    />
                    {manualEngineOnboardingAllowed && (
                      <Button kind="primary" renderIcon={Add} onClick={openNew} disabled={!canCreateEngine} title={canCreateEngine ? undefined : createEngineUnavailableReason}>
                        Add engine
                      </Button>
                    )}
                  </TableToolbarContent>
                </TableToolbar>
                <Table {...getTableProps()} size="md" useZebraStyles>
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => {
                        const { key, ...headerProps } = getHeaderProps({ header })
                        return (
                          <TableHeader
                            key={key || header.key}
                            {...headerProps}
                            style={
                              header.key === 'actions'
                                ? { width: 144, textAlign: 'right' }
                                : undefined
                            }
                          >
                            {header.header}
                          </TableHeader>
                        )
                      })}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tableRows.length === 0 && (
                      <TableRow>
                      <TableCell colSpan={headers.length}>No engines match the current search and metadata filters.</TableCell>
                      </TableRow>
                    )}
                    {tableRows.map((row) => {
                      const { key: rowKey, ...rowProps } = getRowProps({ row })
                      const engine = rows.find((e) => e.id === row.id)
                      const actions = getActionsForEngine(engine)
                      const testUnavailableReason = getEngineTestUnavailableReason(actions, engine)
                      const membersUnavailableReason = getEngineMembersUnavailableReason(actions)
                      const deleteUnavailableReason = getEngineDeleteUnavailableReason(actions, manualEngineOnboardingAllowed, engine)
                      const inventoryReadDecision = getEngineInventoryReadDecision(engine, permissions)
                      const hasActions = actions.canEdit || actions.canTest || actions.canOpenMembers || actions.canDelete

                      return (
                        <TableRow key={rowKey || row.id} {...rowProps}>
                          {row.cells.map((cell) => {
                            const key = cell.info.header

                            if (key === 'name') {
                              const diagnosticTags = getEngineRowDiagnosticTags(engine)
                              return (
                                <TableCell key={cell.id}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
                                    {!hasActions && inventoryReadDecision.allowed ? (
                                      <Button
                                        kind="ghost"
                                        size="sm"
                                        onClick={() => {
                                          if (engine) openEngineDetails(engine)
                                        }}
                                        style={{ minBlockSize: 0, paddingInline: 0 }}
                                      >
                                        {cell.value}
                                      </Button>
                                    ) : (
                                      <span>{cell.value}</span>
                                    )}
                                    {diagnosticTags.map((tag) => (
                                      <Tag key={tag.label} type={tag.type} size="sm" title={tag.title}>
                                        {tag.label}
                                      </Tag>
                                    ))}
                                  </div>
                                </TableCell>
                              )
                            }

                            if (key === 'baseUrl') {
                              const url = engine?.baseUrl
                              const safeHref = (() => {
                                if (typeof url !== 'string') return null
                                const raw = url.trim()
                                if (!raw) return null
                                if (raw.startsWith('//')) return null
                                try {
                                  const u = new URL(raw, window.location.origin)
                                  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
                                  return u.toString()
                                } catch {
                                  return null
                                }
                              })()
                              return (
                                <TableCell key={cell.id}>
                                  {safeHref ? (
                                    <a
                                      href={safeHref}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
                                    >
                                      {safeHref}
                                    </a>
                                  ) : url ? (
                                    <span>{String(url)}</span>
                                  ) : (
                                    '—'
                                  )}
                                </TableCell>
                              )
                            }

                            if (key === 'environment') {
                              const envTag = Array.isArray(envTags)
                                ? envTags.find((t) => t.id === engine?.environmentTagId)
                                : null
                              return (
                                <TableCell key={cell.id}>
                                  {envTag ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <div
                                        style={{
                                          width: 8,
                                          height: 8,
                                          borderRadius: '50%',
                                          background: envTag.color || undefined,
                                        }}
                                      />
                                      <span style={{ fontSize: '13px' }}>{envTag.name}</span>
                                    </div>
                                  ) : (
                                    '—'
                                  )}
                                </TableCell>
                              )
                            }

                            if (key === 'health') {
                              const id = row.id
                              return (
                                <TableCell key={cell.id}>
                                  <EngineHealthBadge engineId={id} version={engine?.version} />
                                </TableCell>
                              )
                            }

                            if (key === 'version') {
                              const id = row.id
                              return (
                                <TableCell key={cell.id}>
                                  <EngineVersionCell engineId={id} initialVersion={engine?.version} />
                                </TableCell>
                              )
                            }

                            if (key === 'actions') {
                              return (
                                <TableCell key={cell.id} onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                                    <EnginePluginActions
                                      engineRef={row.id}
                                      displayName={engine?.name ?? undefined}
                                      product={engine?.type ?? undefined}
                                      productVersion={engine?.version ?? undefined}
                                    />
                                    {hasActions && (
                                      <GuardedOverflowMenu size="sm" flipped wrapperClasses="eg-no-tooltip" iconDescription="Options">
                                      {(actions.canEdit || inventoryReadDecision.allowed) && (
                                        <GuardedOverflowMenuItem
                                          itemText={actions.canEdit ? 'Edit' : 'View details'}
                                          onClick={() => {
                                            if (!engine) return
                                            actions.canEdit ? openEdit(engine) : openEngineDetails(engine)
                                          }}
                                        />
                                      )}
                                      {actions.canTest && (
                                        <GuardedOverflowMenuItem
                                          itemText="Test connection"
                                          unavailableReason={testUnavailableReason}
                                          onClick={() => {
                                            testEngine(engine)
                                          }}
                                        />
                                      )}
                                      {actions.canOpenMembers && (
                                        <GuardedOverflowMenuItem
                                          itemText={engineAccessAuthority === 'sso_managed'
                                            ? 'View access'
                                            : actions.canManageMembers || actions.canAddMembers || actions.canInviteMembers || actions.canUpdateMemberRoles || actions.canRemoveMembers || actions.canManageDelegate
                                              ? 'Manage access'
                                              : 'View access'}
                                          unavailableReason={membersUnavailableReason}
                                          onClick={() => {
                                            if (engine) openMembersPanel(engine)
                                          }}
                                        />
                                      )}
                                      {actions.canDelete && (
                                        <GuardedOverflowMenuItem
                                          itemText="Delete"
                                          isDelete
                                          hasDivider
                                          unavailableReason={deleteUnavailableReason}
                                          onClick={() => {
                                            deleteEngine(engine)
                                          }}
                                        />
                                      )}
                                      </GuardedOverflowMenu>
                                    )}
                                  </div>
                                </TableCell>
                              )
                            }

                            return <TableCell key={cell.id}>{cell.value}</TableCell>
                          })}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </>
            )}
          </DataTable>
        </TableContainer>
      )}

      {/* Engine Members Panel - Using extracted component */}
      <EngineMembersModal
        open={membersOpen}
        engine={selectedEngine}
        canManage={selectedEngine ? getActionsForEngine(selectedEngine).canManageMembers : false}
        engineAccessAuthority={engineAccessAuthority}
        canViewMembers={selectedEngine ? getActionsForEngine(selectedEngine).canViewMembers : false}
        canLookupMembers={selectedEngine ? getActionsForEngine(selectedEngine).canLookupMembers : false}
        canInviteMembers={selectedEngine ? getActionsForEngine(selectedEngine).canInviteMembers : false}
        canAddMembers={selectedEngine ? getActionsForEngine(selectedEngine).canAddMembers : false}
        canUpdateMemberRoles={selectedEngine ? getActionsForEngine(selectedEngine).canUpdateMemberRoles : false}
        canRemoveMembers={selectedEngine ? getActionsForEngine(selectedEngine).canRemoveMembers : false}
        canManageDelegate={selectedEngine ? getActionsForEngine(selectedEngine).canManageDelegate : false}
        canViewProjectAccess={selectedEngine ? getActionsForEngine(selectedEngine).canViewProjectAccess : false}
        canApproveProjectAccess={selectedEngine ? getActionsForEngine(selectedEngine).canApproveProjectAccess : false}
        canDenyProjectAccess={selectedEngine ? getActionsForEngine(selectedEngine).canDenyProjectAccess : false}
        onClose={closeMembersPanel}
      />

      <FormModal
        open={engineModal.isOpen}
        onClose={() => {
          engineModal.closeModal()
          setEditing(null)
        }}
        onSubmit={() => {
          if (editing) {
            if (isEngineFormReadOnly) {
              engineModal.closeModal()
              setEditing(null)
              return
            }
            if (isEngineEnvironmentOnlyEditable) {
              setEnvironmentM.mutate({
                engineId: String(editing.id),
                environmentTagId: form.environmentTagId || null,
              })
              return
            }
            if (!getActionsForEngine(editing).canEdit) return
            const payload = buildEngineMutationPayload(form, editing, { canManageSecrets: canManageEditingSecrets })
            updateM.mutate(payload)
          }
          else {
            if (!canCreateEngine) return
            const payload = buildEngineMutationPayload(form, null, { canManageSecrets: canManageEditingSecrets })
            createM.mutate(payload)
          }
        }}
        title={editing ? (isEngineFormReadOnly ? 'Engine details' : isEngineEnvironmentOnlyEditable ? 'Edit engine environment' : 'Edit engine') : 'Add engine'}
        submitText={editing ? (isEngineFormReadOnly ? 'Close' : 'Save') : 'Create'}
        busy={createM.isPending || updateM.isPending || setEnvironmentM.isPending}
        submitDisabled={isEngineFormReadOnly ? false : isEngineEnvironmentOnlyEditable ? setEnvironmentM.isPending : (!form.name || (!areSourceOwnedFieldsReadOnly && !form.baseUrl) || (!areAuthFieldsReadOnly && (isOAuth2ClientCredentialsIncomplete || isCredentiallessEndpointInvalid)) || (!editing && !canCreateEngine))}
        size="lg"
      >
        {editing && engineDetailSections.includes('registration') && <EngineRegistrationSection engine={editing} />}
        {editing && (
          <EngineTenancyPanel
            engine={editing}
            canManage={Boolean(editingActions?.canEdit && !isConfigLocked && !isExternallyManagedEngine(editing))}
            managementReason={isConfigLocked
              ? 'This topology is managed by its configuration bundle.'
              : isExternallyManagedEngine(editing)
                ? 'This topology is managed by its external registration source.'
                : editingActions?.canEdit
                  ? null
                  : 'Engine edit permission is required to change topology or tenant mappings.'}
          />
        )}
        {editing?.type === 'camunda7' && <CamundaNativeGrantMigrationPanel engineId={editing.id} />}
        {editing && isEngineBackstopNativeAuthorizationEngineType(editing.type) && editing.lifecycleStatus === 'active' && <EngineBackstopPanel engineId={editing.id} connectionMode={editing.connectionMode || 'direct'} />}
        {editing && engineDetailSections.includes('access') && (
          <EngineAccessSection
            assignments={accessAssignmentsQ.data || []}
            assignmentsError={accessAssignmentsQ.error}
            assignmentsLoading={accessAssignmentsQ.isLoading}
            canViewMembers={Boolean(editingActions?.canViewMembers)}
            membersError={accessMembersQ.error}
            membersLoading={accessMembersQ.isLoading}
            membersResponse={accessMembersQ.data}
            canViewRuntimeResources={Boolean(editing?.runtimeAccessScope === 'resource_aware' && runtimeResourcesReadDecision.allowed)}
            runtimeResources={runtimeResourcesQ.data || []}
            runtimeResourcesError={runtimeResourcesQ.error}
            runtimeResourcesLoading={runtimeResourcesQ.isLoading}
            runtimeResourceSets={runtimeResourceSetsQ.data || []}
            runtimeResourceSetsError={runtimeResourceSetsQ.error}
            runtimeResourceSetsLoading={runtimeResourceSetsQ.isLoading}
            runtimeAssignments={runtimeAssignmentsQ.data || []}
            runtimeAssignmentsError={runtimeAssignmentsQ.error}
            runtimeAssignmentsLoading={runtimeAssignmentsQ.isLoading}
            canViewRuntimeAssignments={assignmentReadDecision.allowed}
          />
        )}
        {editing && engineDetailSections.includes('deployment') && (
          <EngineDeploymentSection
            canViewProjectAccess={canViewEditingProjectAccess}
            error={deploymentTargetsQ.error}
            history={deploymentHistoryQ.data || []}
            historyError={deploymentHistoryQ.error}
            historyLoading={deploymentHistoryQ.isLoading}
            lineage={deploymentLineageQ.data}
            lineageError={deploymentLineageQ.error}
            lineageLoading={deploymentLineageQ.isLoading}
            onSelectLineage={setSelectedDeploymentLineageId}
            selectedDeploymentId={selectedDeploymentLineageId}
            isLoading={deploymentTargetsQ.isLoading}
            receipts={deploymentReceiptsQ.data || []}
            receiptsError={deploymentReceiptsQ.error}
            receiptsLoading={deploymentReceiptsQ.isLoading}
            targets={deploymentTargetsQ.data || []}
          />
        )}
        {editing && engineDetailSections.includes('runtime') && <EngineRuntimeResourcesSection resources={runtimeResourcesQ.data || []} loading={runtimeResourcesQ.isLoading} error={runtimeResourcesQ.error} />}
        {editing && isExternallyManagedEngine(editing) && (
          <InlineNotification
            lowContrast
            kind="info"
            title="Externally registered engine"
            subtitle="Connection, authentication, labels, external id, and version are managed by the external registration source. Local display name and environment remain editable here."
            hideCloseButton
          />
        )}
        {editing && isConfigLockedEngine(editing) && (
          <InlineNotification
            lowContrast
            kind="info"
            title="Managed by configuration"
            subtitle="This engine is config-locked. Update its configuration bundle to change inventory, runtime access, deployment, or connection settings."
            hideCloseButton
          />
        )}
        {editing && isConfigWarnEngine(editing) && (
          <InlineNotification
            lowContrast
            kind="warning"
            title="Configuration override"
            subtitle="Saving local changes is allowed, but the engine will be marked as drifted from its configuration bundle."
            hideCloseButton
          />
        )}
        {editing && !canViewEditingSecrets && (
          <InlineNotification
            lowContrast
            kind="info"
            title="Authentication fields redacted"
            subtitle="Current authentication values are hidden because this role does not include engine secret view permission."
            hideCloseButton
          />
        )}
        {editing && !canManageEditingSecrets && !areSourceOwnedFieldsReadOnly && (
          <InlineNotification
            lowContrast
            kind="info"
            title="Authentication fields read-only"
            subtitle="Changing authentication values requires engine secret management permission."
            hideCloseButton
          />
        )}
        {!editing && (
          <InlineNotification
            lowContrast
            kind="info"
            title="Required settings and defaults"
            subtitle="Engine name and endpoint URL must be entered. Every required choice already has a default; review it before creating the engine. Optional and conditional settings are labelled, and shared engines require tenant mappings after creation."
            hideCloseButton
          />
        )}
        <EngineFormSection
          id="engine-connection-settings"
          title="Engine and connection"
          description="Identify the engine and tell EnterpriseGlue which endpoint it should call."
        >
          <TextInput
            id="eng-name"
            labelText="Engine name (required)"
            helperText="A recognizable name for engine selectors, access rules, and diagnostics."
            value={form.name}
            onChange={(e) => setForm((f: any) => ({ ...f, name: (e.target as any).value }))}
            disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
          />
          <ExplainedDropdown
            id="eng-type"
            title="Engine product"
            placeholder="Choose an engine product"
            items={ENGINE_TYPE_ITEMS}
            selectedId={form.type}
            onChange={(type) => setForm((current: EngineMutationForm) => ({ ...current, type: type as EngineType }))}
            disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areSourceOwnedFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
          />
          <ExplainedDropdown
            id="eng-connection-mode"
            title="How EnterpriseGlue connects"
            placeholder="Choose a connection path"
            items={CONNECTION_MODE_ITEMS}
            selectedId={form.connectionMode}
            onChange={(connectionMode) => setForm((current: EngineMutationForm) => ({ ...current, connectionMode: connectionMode as EngineConnectionMode }))}
            disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areSourceOwnedFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
          />
          <TextInput
            id="eng-url"
            labelText="Endpoint URL (required)"
            helperText={form.connectionMode === 'customer_sidecar'
              ? 'Enter the customer-managed gateway or sidecar URL that EnterpriseGlue can reach.'
              : 'Enter the engine REST API URL that EnterpriseGlue can reach.'}
            placeholder={form.connectionMode === 'customer_sidecar'
              ? 'https://gateway.example.com/engine'
              : 'http://localhost:8080/engine-rest'}
            value={form.baseUrl}
            onChange={(e) => setForm((f: any) => ({ ...f, baseUrl: (e.target as any).value }))}
            disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areSourceOwnedFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
          />
          {dockerLoopbackSuggestion && (
            <InlineNotification
              lowContrast
              kind="warning"
              title="Docker cannot reach this localhost URL"
              subtitle={`When EnterpriseGlue runs in Docker and the engine runs on the host machine, use ${dockerLoopbackSuggestion} instead.`}
              hideCloseButton
            />
          )}
          {hasMultipleTags && (
            <div>
              <Dropdown
                id="eng-env"
                titleText="Environment label (optional)"
                label="Choose an environment"
                items={envTags!.map(t => ({ id: t.id, label: t.name, color: t.color }))}
                itemToString={(it: any) => it ? it.label : ''}
                selectedItem={envTags!.map(t => ({ id: t.id, label: t.name, color: t.color })).find(i => i.id === form.environmentTagId)}
                onChange={({ selectedItem }: any) => setForm((f: any) => ({ ...f, environmentTagId: selectedItem?.id || '' }))}
                disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || (editing && editing.environmentLocked) || !canSetEditingEnvironment}
              />
              <SettingExplanation requirement="Optional" description="Use an environment label such as Development, Test, or Production to organize engines and deployment targets." />
            </div>
          )}
          {hasSingleTag && (
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)', display: 'block', marginBottom: 'var(--spacing-2)' }}>
                Environment label (automatically assigned)
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: envTags![0].color || undefined }} />
                <span style={{ fontSize: '0.875rem' }}>{envTags![0].name}</span>
                <Tag type="gray" size="sm">Automatic</Tag>
              </div>
            </div>
          )}
        </EngineFormSection>

        <EngineFormSection
          id="engine-authentication-settings"
          title="Endpoint authentication"
          description="Choose how EnterpriseGlue proves its identity to the endpoint URL above. This is separate from user access inside EnterpriseGlue."
        >
          <ExplainedDropdown
            id="eng-auth"
            title="How EnterpriseGlue authenticates"
            placeholder="Choose an authentication method"
            items={AUTH_ITEMS}
            selectedId={form.authType}
            onChange={(authType) => setForm((current: EngineMutationForm) => ({ ...current, authType: authType as EngineAuthType }))}
            disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areAuthFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
          />
          {form.authType === 'none' && (
            <InlineNotification
              lowContrast
              kind={isCredentiallessEndpointInvalid ? 'warning' : 'info'}
              title={isCredentiallessEndpointInvalid ? 'This authentication choice cannot be saved' : 'Customer gateway authentication is allowed'}
              subtitle={form.connectionMode !== 'customer_sidecar'
                ? 'No credentials is valid only when the connection goes through a customer-managed sidecar or gateway.'
                : platformSettingsQ.data?.credentiallessCustomerSidecarsEnabled !== true
                  ? 'A platform administrator must first allow peer-authenticated customer sidecars in Platform Settings.'
                  : 'The gateway authenticates the downstream engine. EnterpriseGlue still makes every user and runtime authorization decision.'}
              hideCloseButton
            />
          )}
          {form.authType === 'basic' && (
            <>
              <TextInput
                id="eng-user"
                labelText="Username (conditional)"
                helperText="Enter the username required by this endpoint."
                value={form.username}
                onChange={(e) => setForm((f: any) => ({ ...f, username: (e.target as any).value }))}
                disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areAuthFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
              />
              <TextInput
                id="eng-pass"
                type="password"
                labelText="Password (conditional)"
                helperText={editing?.hasCredential
                  ? 'Leave blank to keep the stored password, or enter a replacement.'
                  : 'Enter the password required by this endpoint.'}
                placeholder={editing?.hasCredential ? 'Keep stored password' : undefined}
                value={form.passwordEnc}
                onChange={(e) => setForm((f: any) => ({ ...f, passwordEnc: (e.target as any).value }))}
                disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areAuthFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
              />
            </>
          )}
          {form.authType === 'bearer' && (
            <TextInput
              id="eng-token"
              type="password"
              labelText="Bearer token (conditional)"
              helperText={editing?.hasCredential
                ? 'Leave blank to keep the stored token, or enter a replacement.'
                : 'Required when Bearer token authentication is selected.'}
              placeholder={editing?.hasCredential ? 'Keep stored token' : 'Enter the endpoint API token'}
              value={form.passwordEnc}
              onChange={(e) => setForm((f: any) => ({ ...f, passwordEnc: (e.target as any).value }))}
              disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areAuthFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
            />
          )}
          {form.authType === 'oauth2-client-credentials' && (
            <>
              <TextInput
                id="eng-oauth-client"
                labelText="Client ID (required for OAuth 2.0)"
                value={form.username}
                onChange={(e) => setForm((f: any) => ({ ...f, username: (e.target as any).value }))}
                disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areAuthFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
              />
              <TextInput
                id="eng-oauth-secret"
                type="password"
                labelText={editing?.hasCredential ? 'Client secret (optional replacement)' : 'Client secret (required for OAuth 2.0)'}
                helperText={editing?.hasCredential ? 'Leave blank to keep the stored client secret.' : undefined}
                placeholder={editing?.hasCredential ? 'Keep stored client secret' : undefined}
                value={form.passwordEnc}
                onChange={(e) => setForm((f: any) => ({ ...f, passwordEnc: (e.target as any).value }))}
                disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areAuthFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
              />
              <TextInput
                id="eng-oauth-token-url"
                labelText="Token URL (required for OAuth 2.0)"
                helperText="The OAuth 2.0 endpoint used to obtain access tokens."
                placeholder="https://identity.example.com/oauth2/token"
                value={form.oauthTokenUrl}
                onChange={(e) => setForm((f: any) => ({ ...f, oauthTokenUrl: (e.target as any).value }))}
                disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areAuthFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
              />
              <TextInput
                id="eng-oauth-scopes"
                labelText="Scopes (optional)"
                helperText="Space-separated scopes requested from the token endpoint."
                value={form.oauthScopes}
                onChange={(e) => setForm((f: any) => ({ ...f, oauthScopes: (e.target as any).value }))}
                disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areAuthFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
              />
              <TextInput
                id="eng-oauth-audience"
                labelText="Audience (optional)"
                helperText="Set only when the identity provider requires an audience value."
                value={form.oauthAudience}
                onChange={(e) => setForm((f: any) => ({ ...f, oauthAudience: (e.target as any).value }))}
                disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areAuthFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
              />
            </>
          )}
        </EngineFormSection>

        <EngineFormSection
          id="engine-access-settings"
          title="Tenant ownership and runtime access"
          description="Tenant ownership decides which tenant owns runtime data. Runtime access decides whether access is granted for the whole engine or for selected resources. Neither setting creates user-group mappings."
        >
          {!editing && (
            <ExplainedDropdown
              id="eng-tenancy-mode"
              title="Who will use this engine?"
              placeholder="Choose tenant ownership"
              items={TENANCY_MODE_ITEMS}
              selectedId={form.tenancyMode}
              onChange={(tenancyMode) => setForm((current: EngineMutationForm) => ({
                ...current,
                tenancyMode: tenancyMode as 'dedicated' | 'shared',
                runtimeAccessScope: tenancyMode === 'shared' ? 'resource_aware' : current.runtimeAccessScope,
              }))}
              disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areSourceOwnedFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
            />
          )}
          {!editing && form.tenancyMode === 'shared' && (
            <>
              <ExplainedDropdown
                id="eng-tenant-mapping-strategy"
                title="How runtime resources map to tenants"
                placeholder="Choose a tenant mapping method"
                items={TENANT_MAPPING_STRATEGY_ITEMS}
                selectedId={form.tenantMappingStrategy}
                onChange={(tenantMappingStrategy) => setForm((current: EngineMutationForm) => ({
                  ...current,
                  tenantMappingStrategy: tenantMappingStrategy as EngineTenantMappingStrategy,
                }))}
                disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending}
                requirement="Conditional"
              />
              <InlineNotification
                lowContrast
                kind="warning"
                title="Shared engines hide unmapped resources"
                subtitle="After creating the engine, configure tenant mappings in its Tenancy panel. A runtime resource remains hidden until it resolves to exactly one tenant."
                hideCloseButton
              />
            </>
          )}
          {editing && (
            <InlineNotification
              lowContrast
              kind="info"
              title="Change tenant ownership in the Tenancy panel above"
              subtitle="Topology changes require a preview and explicit acknowledgement, so they are kept separate from ordinary engine settings."
              hideCloseButton
            />
          )}
          <ExplainedDropdown
            id="eng-runtime-access-scope"
            title="How access is granted"
            placeholder="Choose an access scope"
            items={RUNTIME_ACCESS_SCOPE_ITEMS}
            selectedId={form.runtimeAccessScope}
            onChange={(runtimeAccessScope) => setForm((current: EngineMutationForm) => ({ ...current, runtimeAccessScope: runtimeAccessScope as RuntimeAccessScope }))}
            disabled={form.tenancyMode === 'shared' || createM.isPending || updateM.isPending || setEnvironmentM.isPending || areSourceOwnedFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
          />
          {form.tenancyMode === 'shared' && (
            <p style={{ margin: 0, color: 'var(--cds-text-secondary)', fontSize: '0.8125rem' }}>
              Shared engines always use selected-resource access so tenant boundaries can be enforced.
            </p>
          )}
        </EngineFormSection>

        <EngineFormSection
          id="engine-deployment-settings"
          title="Deployments and discovery"
          description="Choose how deployments arrive, then decide which metadata EnterpriseGlue should keep synchronized."
        >
          <ExplainedDropdown
            id="eng-deployment-integration"
            title="How deployments reach the engine"
            placeholder="Choose a deployment path"
            items={DEPLOYMENT_INTEGRATION_ITEMS}
            selectedId={form.deploymentIntegration}
            onChange={(deploymentIntegration) => setForm((current: EngineMutationForm) => ({ ...current, deploymentIntegration: deploymentIntegration as DeploymentIntegration }))}
            disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areSourceOwnedFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
          />
          <div>
            <Toggle
              id="eng-metadata-discovery"
              labelText="Discover processes, decisions, and runtime resources"
              labelA="Off"
              labelB="On"
              toggled={form.metadataDiscoveryEnabled}
              onToggle={(checked) => setForm((f: any) => ({ ...f, metadataDiscoveryEnabled: checked }))}
              disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areSourceOwnedFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
            />
            <SettingExplanation requirement="Optional" description="Keeps EnterpriseGlue's runtime inventory synchronized with the engine. Enabled by default." />
          </div>
          {form.metadataDiscoveryEnabled && (
            <TextInput
              id="eng-reconciliation-interval"
              type="number"
              min={60}
              max={86400}
              step={60}
              labelText="Discovery refresh interval in seconds (required while discovery is on)"
              helperText="Allowed range: 60 seconds to 86,400 seconds. Default: 300 seconds."
              value={form.reconciliationIntervalSeconds}
              onChange={(event) => setForm((f: any) => ({ ...f, reconciliationIntervalSeconds: Number(event.target.value) }))}
              disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areSourceOwnedFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
            />
          )}
          <div>
            <Toggle
              id="eng-deployment-discovery"
              labelText="Discover deployment history"
              labelA="Off"
              labelB="On"
              toggled={form.deploymentDiscoveryEnabled}
              onToggle={(checked) => setForm((f: any) => ({ ...f, deploymentDiscoveryEnabled: checked }))}
              disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areSourceOwnedFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
            />
            <SettingExplanation requirement="Optional" description="Imports deployment history from the engine when the adapter supports it. Enabled by default." />
          </div>
          {form.deploymentIntegration === 'direct_engine' && (
            <div>
              <Toggle
                id="eng-pipeline-receipts"
                labelText="Accept deployment receipts from external pipelines"
                labelA="Off"
                labelB="On"
                toggled={form.pipelineReceiptEnabled}
                onToggle={(checked) => setForm((f: any) => ({ ...f, pipelineReceiptEnabled: checked }))}
                disabled={createM.isPending || updateM.isPending || setEnvironmentM.isPending || areSourceOwnedFieldsReadOnly || isEngineFormReadOnly || isEngineEnvironmentOnlyEditable}
              />
              <SettingExplanation requirement="Conditional" description="Used only for external-pipeline deployments. Receipts let EnterpriseGlue record lineage without performing the deployment." />
            </div>
          )}
        </EngineFormSection>
      </FormModal>
    </PageLayout>
  )
}

function EngineHealthBadge({ engineId, version }: { engineId: string; version?: string | null }) {
  const q = useQuery({
    queryKey: ['engines','health', engineId],
    queryFn: () => getEngineConnectionHealth(engineId),
    ...engineHealthQueryPolicy,
  })
  const h = q.data
  const status = h?.status || 'unknown'
  const label = status === 'connected' ? 'Connected' : (status === 'disconnected' ? 'Disconnected' : 'Unknown')
  const type = status === 'connected' ? 'green' : (status === 'disconnected' ? 'red' : 'cool-gray')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
      <Tag type={type as any}>{label}</Tag>
      {typeof h?.latencyMs === 'number' && <span style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>{h.latencyMs} ms</span>}
    </div>
  )
}

/**
 * The engine table already owns the health query used by its health badge.
 * Pass only the compact, non-sensitive state to contextual plugins so their
 * action can describe the current user intent without gaining host access.
 */
function EngineVersionCell({ engineId, initialVersion }: { engineId: string; initialVersion?: string | null }) {
  const q = useQuery({
    queryKey: ['engines','health', engineId],
    queryFn: () => getEngineConnectionHealth(engineId),
    ...engineHealthQueryPolicy,
  })
  const v = initialVersion || q.data?.version
  return <span style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>{v ? `v${v}` : '—'}</span>
}
