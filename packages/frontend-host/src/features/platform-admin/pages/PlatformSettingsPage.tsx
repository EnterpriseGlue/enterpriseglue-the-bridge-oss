import React, { useContext, useState } from 'react';
import { Settings } from '@carbon/icons-react';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../../shared/components/PageLayout';
import {
  SkeletonText,
  InlineNotification,
  Modal,
  TextInput,
  TextArea,
  ComboBox,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
} from '@carbon/react';
import {
  usePlatformSettings,
  useUpdatePlatformSettings,
  useEnvironmentTags,
  useCreateEnvironmentTag,
  useUpdateEnvironmentTag,
  useDeleteEnvironmentTag,
  useReorderEnvironmentTags,
  useProjectsGovernance,
  useEnginesGovernance,
  useAdminUsers,
  useAssignProjectOwner,
  useAssignProjectDelegate,
  useAssignEngineOwner,
  useAssignEngineDelegate,
  useAdminGitProviders,
  useUpdateGitProvider,
} from '../hooks/useAdminApi';
import type {
  EnvironmentTag,
  ProjectGovernanceItem,
  EngineGovernanceItem,
  AccessAuthorityMode,
  EngineOnboardingMode,
  ProjectEngineTargetPolicyMode,
  UserListItem,
} from '../../../api/platform-admin';
import IdentityProvidersSettingsTab from '../components/IdentityProvidersSettingsTab';
import IdentityMappingsSettingsTab from '../components/IdentityMappingsSettingsTab';
import ConfigurationBundleSettingsTab from '../components/ConfigurationBundleSettingsTab';
import RoleLibrarySettingsTab from '../components/RoleLibrarySettingsTab';
import { GitSettingsSection } from '../components/GitSettingsSection';
import { ProjectsSettingsSection } from '../components/ProjectsSettingsSection';
import { InviteDomainsSettingsSection } from '../components/InviteDomainsSettingsSection';
import { EnginesSettingsSection } from '../components/EnginesSettingsSection';
import EmailConfigurations from '../../../pages/admin/EmailConfigurations';
import EmailTemplates from '../../../pages/admin/EmailTemplates';
import BrandingSettingsTab from '../components/BrandingSettingsTab';
import { PiiRedactionSettingsSection } from '../components/PiiRedactionSettingsSection';
import { AuthContext } from '../../../contexts/AuthContext';
import { evaluateActionSnapshot } from '../../../shared/auth/guards';
import {
  ACCESS_CONTROL_PLATFORM_PERMISSIONS,
  hasAnyPlatformPermission,
  PlatformPermission,
  PLATFORM_SETTINGS_HUB_PLATFORM_PERMISSIONS,
} from '../../../shared/auth/permissions';

const AccessControl = React.lazy(() => import('./AccessControl'));
const AuthzPolicies = React.lazy(() => import('./AuthzPolicies'));
const AuthzAuditLog = React.lazy(() => import('./AuthzAuditLog'));
const AuditLogViewer = React.lazy(() => import('../../../pages/AuditLogViewer'));

// Predefined colors for environment tags
const TAG_COLORS = [
  '#24a148', // Green - Dev
  '#f1c21b', // Yellow - Test
  '#ff832b', // Orange - Staging
  '#da1e28', // Red - Production
  '#0f62fe', // Blue
  '#8a3ffc', // Purple
  '#00539a', // Dark Blue
  '#a2191f', // Dark Red
];

type PlatformSettingsSectionVisibility =
  | 'settings'
  | 'settings-or-git-manage'
  | 'settings-or-governance-read'
  | 'identity-providers'
  | 'identity-mappings'
  | 'configuration'
  | 'access-control'
  | 'authz-policies'
  | 'audit';

const PLATFORM_SETTINGS_SECTION_REGISTRY = [
  { id: 'git', label: 'Git', visibility: 'settings-or-git-manage' },
  { id: 'projects', label: 'Projects', visibility: 'settings-or-governance-read' },
  { id: 'invite-domains', label: 'Invite Domains', visibility: 'settings' },
  { id: 'pii-redaction', label: 'PII Redaction', visibility: 'settings' },
  { id: 'engines', label: 'Engines', visibility: 'settings-or-governance-read' },
  { id: 'identity-providers', label: 'Identity Providers', visibility: 'identity-providers' },
  { id: 'identity-mappings', label: 'Identity Mappings', visibility: 'identity-mappings' },
  { id: 'configuration', label: 'Configuration', visibility: 'configuration' },
  { id: 'role-library', label: 'Role Library', visibility: 'access-control' },
  { id: 'access-control', label: 'Access Control', visibility: 'access-control' },
  { id: 'authz-policies', label: 'Authorization Policies', visibility: 'authz-policies' },
  { id: 'authz-audit', label: 'Authorization Audit', visibility: 'audit' },
  { id: 'audit-logs', label: 'System Audit Logs', visibility: 'audit' },
  { id: 'email', label: 'Email', visibility: 'settings' },
  { id: 'email-templates', label: 'Email Templates', visibility: 'settings' },
  { id: 'branding', label: 'Branding', visibility: 'settings' },
] as const satisfies ReadonlyArray<{ id: string; label: string; visibility: PlatformSettingsSectionVisibility }>;

type PlatformSettingsSection = typeof PLATFORM_SETTINGS_SECTION_REGISTRY[number]['id'];
const PLATFORM_SETTINGS_SECTION_BY_ID = new Map(PLATFORM_SETTINGS_SECTION_REGISTRY.map((section) => [section.id, section]));

interface PlatformSettingsPageProps {
  section?: PlatformSettingsSection;
}

export default function PlatformSettingsPage({ section }: PlatformSettingsPageProps) {
  const authContext = useContext(AuthContext);
  const platformResource = { type: 'platform' as const, id: null };
  const hasPermissionSnapshot = Boolean(authContext?.permissions);
  const permissionSnapshot = authContext?.permissions ?? null;
  const settingsReadDecision = evaluateActionSnapshot(authContext?.permissions ?? null, 'platform.settings.read', platformResource);
  const settingsManageDecision = evaluateActionSnapshot(authContext?.permissions ?? null, 'platform.settings.manage', platformResource);
  const governanceReadDecision = evaluateActionSnapshot(authContext?.permissions ?? null, 'platform.governance.read', platformResource);
  const governanceManageDecision = evaluateActionSnapshot(authContext?.permissions ?? null, 'platform.governance.manage', platformResource);
  const gitProvidersManageDecision = evaluateActionSnapshot(authContext?.permissions ?? null, 'platform.git.providers.manage', platformResource);
  const canViewPlatformSettingsHub = !hasPermissionSnapshot || hasAnyPlatformPermission(permissionSnapshot, PLATFORM_SETTINGS_HUB_PLATFORM_PERMISSIONS);
  const canReadSettings = !hasPermissionSnapshot || settingsReadDecision.allowed;
  const canManageSettings = !hasPermissionSnapshot || settingsManageDecision.allowed;
  const canReadGovernance = !hasPermissionSnapshot || governanceReadDecision.allowed;
  const canManageGovernance = !hasPermissionSnapshot || governanceManageDecision.allowed;
  const canManageGitProviders = !hasPermissionSnapshot || gitProvidersManageDecision.allowed;
  const canViewAccessControl = !hasPermissionSnapshot || hasAnyPlatformPermission(permissionSnapshot, ACCESS_CONTROL_PLATFORM_PERMISSIONS);
  const canViewSsoMappings = !hasPermissionSnapshot || hasAnyPlatformPermission(permissionSnapshot, [
    PlatformPermission.SSO_ASSIGNMENTS_VIEW,
    PlatformPermission.SSO_ASSIGNMENTS_MANAGE,
  ]);
  const canViewIdentityProviders = !hasPermissionSnapshot || hasAnyPlatformPermission(permissionSnapshot, [
    PlatformPermission.SSO_PROVIDERS_VIEW,
    PlatformPermission.SSO_PROVIDERS_MANAGE,
  ]);
  const canViewConfiguration = !hasPermissionSnapshot || hasAnyPlatformPermission(permissionSnapshot, [
    PlatformPermission.CONFIG_BUNDLES_VIEW,
    PlatformPermission.CONFIG_BUNDLES_PREVIEW,
    PlatformPermission.CONFIG_BUNDLES_APPLY,
    PlatformPermission.CONFIG_BUNDLES_EXPORT,
  ]);
  const canViewAuthzPolicies = !hasPermissionSnapshot || hasAnyPlatformPermission(permissionSnapshot, [PlatformPermission.AUTHZ_ROLES_MANAGE]);
  const canViewAudit = !hasPermissionSnapshot || hasAnyPlatformPermission(permissionSnapshot, [PlatformPermission.AUDIT_VIEW]);
  const sectionVisibility: Record<PlatformSettingsSectionVisibility, boolean> = {
    settings: canReadSettings,
    'settings-or-git-manage': canReadSettings || canManageGitProviders,
    'settings-or-governance-read': canReadSettings || canReadGovernance,
    'identity-providers': canViewIdentityProviders,
    'identity-mappings': canViewSsoMappings,
    configuration: canViewConfiguration,
    'access-control': canViewAccessControl,
    'authz-policies': canViewAuthzPolicies,
    audit: canViewAudit,
  };
  const settingsReadUnavailableReason = hasPermissionSnapshot && !settingsReadDecision.allowed ? settingsReadDecision.reason : null;
  const settingsManageUnavailableReason = hasPermissionSnapshot && !settingsManageDecision.allowed ? settingsManageDecision.reason : null;
  const governanceReadUnavailableReason = hasPermissionSnapshot && !governanceReadDecision.allowed ? governanceReadDecision.reason : null;
  const governanceManageUnavailableReason = hasPermissionSnapshot && !governanceManageDecision.allowed ? governanceManageDecision.reason : null;
  const gitProvidersManageUnavailableReason = hasPermissionSnapshot && !gitProvidersManageDecision.allowed ? gitProvidersManageDecision.reason : null;

  const { data: settings, isLoading, error } = usePlatformSettings({ enabled: canReadSettings });
  const { data: envTags, isLoading: envLoading } = useEnvironmentTags({ enabled: canReadSettings });
  const { data: gitProviders, isLoading: gitProvidersLoading } = useAdminGitProviders({ enabled: canManageGitProviders });
  const updateSettings = useUpdatePlatformSettings();
  const updateGitProvider = useUpdateGitProvider();
  const createTag = useCreateEnvironmentTag();
  const updateTag = useUpdateEnvironmentTag();
  const deleteTag = useDeleteEnvironmentTag();
  const reorderTags = useReorderEnvironmentTags();
  const [piiSaving, setPiiSaving] = useState(false);

  // Drag and drop state
  const [draggedTagId, setDraggedTagId] = useState<string | null>(null);
  const [dragOverTagId, setDragOverTagId] = useState<string | null>(null);

  // Environment tag modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<EnvironmentTag | null>(null);
  const [deleteConfirmTag, setDeleteConfirmTag] = useState<EnvironmentTag | null>(null);
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState(TAG_COLORS[0]);
  const [formManualDeploy, setFormManualDeploy] = useState(true);

  // Governance state
  const [selectedProject, setSelectedProject] = useState<ProjectGovernanceItem | null>(null);
  const [selectedEngine, setSelectedEngine] = useState<EngineGovernanceItem | null>(null);
  const [projectComboKey, setProjectComboKey] = useState(0);
  const [engineComboKey, setEngineComboKey] = useState(0);
  const [assignModalType, setAssignModalType] = useState<'projectOwner' | 'projectDelegate' | 'engineOwner' | 'engineDelegate' | null>(null);
  const [assignTarget, setAssignTarget] = useState<{ id: string; name: string } | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserListItem | null>(null);
  const [userComboKey, setUserComboKey] = useState(0);
  const [assignReason, setAssignReason] = useState('');

  // Invite domains
  const [inviteDomainInput, setInviteDomainInput] = useState('');

  // Governance hooks - fetch all projects/engines for ComboBox
  const { data: allProjects, isLoading: projectsLoading } = useProjectsGovernance(undefined, { enabled: canReadGovernance });
  const { data: allEngines, isLoading: enginesLoading } = useEnginesGovernance(undefined, { enabled: canReadGovernance });
  const { data: allUsers } = useAdminUsers({ limit: 100 }, { enabled: canReadGovernance });
  const assignProjectOwner = useAssignProjectOwner();
  const assignProjectDelegate = useAssignProjectDelegate();
  const assignEngineOwner = useAssignEngineOwner();
  const assignEngineDelegate = useAssignEngineDelegate();

  const resetForm = () => {
    setFormName('');
    setFormColor(TAG_COLORS[0]);
    setFormManualDeploy(true);
  };

  const openCreateModal = () => {
    if (!canManageSettings) return;
    resetForm();
    setCreateModalOpen(true);
  };

  const openEditModal = (tag: EnvironmentTag) => {
    if (!canManageSettings) return;
    setFormName(tag.name);
    setFormColor(tag.color ?? TAG_COLORS[0]);
    setFormManualDeploy(tag.manualDeployAllowed);
    setEditingTag(tag);
  };

  const handleCreateTag = () => {
    if (!canManageSettings) return;
    createTag.mutate(
      { name: formName, color: formColor, manualDeployAllowed: formManualDeploy },
      { onSuccess: () => { setCreateModalOpen(false); resetForm(); } }
    );
  };

  const handleUpdateTag = () => {
    if (!canManageSettings || !editingTag) return;
    updateTag.mutate(
      { id: editingTag.id, name: formName, color: formColor, manualDeployAllowed: formManualDeploy },
      { onSuccess: () => { setEditingTag(null); resetForm(); } }
    );
  };

  const handleDeleteTag = () => {
    if (!canManageSettings || !deleteConfirmTag) return;
    deleteTag.mutate(deleteConfirmTag.id, {
      onSuccess: () => setDeleteConfirmTag(null),
    });
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, tagId: string) => {
    setDraggedTagId(tagId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tagId);
  };

  const handleDragOver = (e: React.DragEvent, tagId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (tagId !== draggedTagId) {
      setDragOverTagId(tagId);
    }
  };

  const handleDragLeave = () => {
    setDragOverTagId(null);
  };

  const handleDrop = (e: React.DragEvent, targetTagId: string) => {
    e.preventDefault();
    if (!canManageSettings || !draggedTagId || draggedTagId === targetTagId || !envTags) return;

    const currentOrder = envTags.map((t: EnvironmentTag) => t.id);
    const draggedIndex = currentOrder.indexOf(draggedTagId);
    const targetIndex = currentOrder.indexOf(targetTagId);

    // Reorder the array
    const newOrder = [...currentOrder];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedTagId);

    reorderTags.mutate(newOrder);
    setDraggedTagId(null);
    setDragOverTagId(null);
  };

  const handleDragEnd = () => {
    setDraggedTagId(null);
    setDragOverTagId(null);
  };

  // Governance handlers
  const openAssignModal = (type: typeof assignModalType, target: { id: string; name: string }) => {
    if (!canManageGovernance) return;
    setAssignModalType(type);
    setAssignTarget(target);
    setSelectedUser(null);
    setUserComboKey(k => k + 1);
    setAssignReason('');
  };

  const closeAssignModal = () => {
    setAssignModalType(null);
    setAssignTarget(null);
    setSelectedUser(null);
    setUserComboKey(k => k + 1);
    setAssignReason('');
  };

  const handleAssign = () => {
    if (!canManageGovernance || !assignTarget || !selectedUser || !assignReason.trim()) return;

    const payload = { userId: selectedUser.id, reason: assignReason };
    const onSuccess = () => closeAssignModal();

    switch (assignModalType) {
      case 'projectOwner':
        assignProjectOwner.mutate({ projectId: assignTarget.id, ...payload }, { onSuccess });
        break;
      case 'projectDelegate':
        assignProjectDelegate.mutate({ projectId: assignTarget.id, ...payload }, { onSuccess });
        break;
      case 'engineOwner':
        assignEngineOwner.mutate({ engineId: assignTarget.id, ...payload }, { onSuccess });
        break;
      case 'engineDelegate':
        assignEngineDelegate.mutate({ engineId: assignTarget.id, ...payload }, { onSuccess });
        break;
    }
  };

  const isAssigning = assignProjectOwner.isPending || assignProjectDelegate.isPending ||
                      assignEngineOwner.isPending || assignEngineDelegate.isPending;

  const handleToggle = (key: 'syncPushEnabled' | 'syncPullEnabled' | 'gitProjectTokenSharingEnabled', value: boolean) => {
    if (!canManageSettings) return;
    updateSettings.mutate({ [key]: value });
  };

  const handleDeployRoleToggle = (role: string, checked: boolean) => {
    if (!canManageSettings || !settings) return;
    const current = Array.isArray(settings.defaultDeployRoles) ? settings.defaultDeployRoles : [];
    const updated = checked
      ? [...current, role]
      : current.filter((r: string) => r !== role);
    updateSettings.mutate({ defaultDeployRoles: updated });
  };

  const handleEngineOnboardingModeChange = (mode: EngineOnboardingMode) => {
    if (!canManageSettings) return;
    updateSettings.mutate({ engineOnboardingMode: mode });
  };

  const handleProjectEngineTargetModeChange = (mode: ProjectEngineTargetPolicyMode) => {
    if (!canManageSettings) return;
    updateSettings.mutate({ projectEngineTargetMode: mode });
  };

  const handleEngineAccessAuthorityChange = (mode: AccessAuthorityMode) => {
    if (!canManageSettings) return;
    updateSettings.mutate({ engineAccessAuthority: mode });
  };

  const handleProjectAccessAuthorityChange = (mode: AccessAuthorityMode) => {
    if (!canManageSettings) return;
    updateSettings.mutate({ projectAccessAuthority: mode });
  };

  const handleCredentiallessCustomerSidecarsEnabledChange = (enabled: boolean) => {
    if (!canManageSettings) return;
    updateSettings.mutate({ credentiallessCustomerSidecarsEnabled: enabled });
  };

  const sectionLabel = section ? PLATFORM_SETTINGS_SECTION_BY_ID.get(section)?.label || null : null;
  const headerTitle = sectionLabel || 'Platform Settings';
  const headerSubtitle = section
    ? 'Configure platform defaults for this area'
    : 'Configure global platform behavior and defaults';

  const renderGit = () => (
    <GitSettingsSection
      settings={settings}
      gitProviders={gitProviders || []}
      gitProvidersLoading={gitProvidersLoading}
      onToggle={handleToggle}
      onUpdateGitProvider={async (id, updates) => {
        if (!canManageGitProviders) return;
        await updateGitProvider.mutateAsync({ id, updates });
      }}
      canManageSettings={canManageSettings}
      settingsUnavailableReason={settingsManageUnavailableReason}
      canManageGitProviders={canManageGitProviders}
      gitProvidersUnavailableReason={gitProvidersManageUnavailableReason}
    />
  );

  const renderProjects = () => (
    <ProjectsSettingsSection
      allProjects={allProjects}
      projectsLoading={projectsLoading}
      selectedProject={selectedProject}
      setSelectedProject={setSelectedProject}
      projectComboKey={projectComboKey}
      setProjectComboKey={setProjectComboKey}
      onAssignOwner={(target) => openAssignModal('projectOwner', target)}
      onAssignDelegate={(target) => openAssignModal('projectDelegate', target)}
      canReadGovernance={canReadGovernance}
      canManageGovernance={canManageGovernance}
      governanceReadUnavailableReason={governanceReadUnavailableReason}
      governanceManageUnavailableReason={governanceManageUnavailableReason}
    />
  );

  const renderInviteDomains = () => (
    <InviteDomainsSettingsSection
      inviteAllowAll={inviteAllowAll}
      normalizedInviteDomains={normalizedInviteDomains}
      inviteDomainInput={inviteDomainInput}
      setInviteDomainInput={setInviteDomainInput}
      addInviteDomain={addInviteDomain}
      removeInviteDomain={removeInviteDomain}
      onToggleInviteAllowAll={(checked) => {
        if (canManageSettings) updateSettings.mutate({ inviteAllowAllDomains: checked } as any);
      }}
      canManageSettings={canManageSettings}
      settingsUnavailableReason={settingsManageUnavailableReason}
    />
  );

  const renderPiiRedaction = () => (
    <PiiRedactionSettingsSection
      settings={settings}
      saving={piiSaving || updateSettings.isPending}
      canManageSettings={canManageSettings}
      settingsUnavailableReason={settingsManageUnavailableReason}
      onSave={async (updates) => {
        if (!canManageSettings) return;
        setPiiSaving(true);
        try {
          await updateSettings.mutateAsync(updates);
        } finally {
          setPiiSaving(false);
        }
      }}
    />
  );

  const renderEngines = () => (
    <EnginesSettingsSection
      settings={settings}
      allEngines={allEngines}
      enginesLoading={enginesLoading}
      selectedEngine={selectedEngine}
      setSelectedEngine={setSelectedEngine}
      engineComboKey={engineComboKey}
      setEngineComboKey={setEngineComboKey}
      onAssignOwner={(target) => openAssignModal('engineOwner', target)}
      onAssignDelegate={(target) => openAssignModal('engineDelegate', target)}
      onEngineOnboardingModeChange={handleEngineOnboardingModeChange}
      onProjectEngineTargetModeChange={handleProjectEngineTargetModeChange}
      onEngineAccessAuthorityChange={handleEngineAccessAuthorityChange}
      onProjectAccessAuthorityChange={handleProjectAccessAuthorityChange}
      onCredentiallessCustomerSidecarsEnabledChange={handleCredentiallessCustomerSidecarsEnabledChange}
      onDeployRoleToggle={handleDeployRoleToggle}
      envTags={envTags}
      envLoading={envLoading}
      onOpenCreateModal={openCreateModal}
      onOpenEditModal={openEditModal}
      onDeleteTag={setDeleteConfirmTag}
      draggedTagId={draggedTagId}
      dragOverTagId={dragOverTagId}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      canManageSettings={canManageSettings}
      settingsUnavailableReason={settingsManageUnavailableReason}
      canReadGovernance={canReadGovernance}
      canManageGovernance={canManageGovernance}
      governanceReadUnavailableReason={governanceReadUnavailableReason}
      governanceManageUnavailableReason={governanceManageUnavailableReason}
    />
  );

  const renderIdentityProviders = () => <IdentityProvidersSettingsTab />;
  const renderIdentityMappings = () => <IdentityMappingsSettingsTab />;
  const renderConfiguration = () => <ConfigurationBundleSettingsTab />;
  const renderRoleLibrary = () => <RoleLibrarySettingsTab />;

  const renderAdminSurface = (children: React.ReactNode) => (
    <React.Suspense fallback={<SkeletonText paragraph lineCount={6} />}>
      {children}
    </React.Suspense>
  );

  const renderAccessControl = () => renderAdminSurface(<AccessControl />);


  const renderAuthzPolicies = () => renderAdminSurface(<AuthzPolicies />);

  const renderAuthzAudit = () => renderAdminSurface(<AuthzAuditLog />);

  const renderAuditLogs = () => renderAdminSurface(<AuditLogViewer />);

  const renderEmail = () => (
    <EmailConfigurations
      embedded
      canManageSettings={canManageSettings}
      settingsUnavailableReason={settingsManageUnavailableReason}
    />
  );

  const renderEmailTemplates = () => (
    <EmailTemplates
      embedded
      canManageSettings={canManageSettings}
      settingsUnavailableReason={settingsManageUnavailableReason}
    />
  );

  const renderBranding = () => (
    <BrandingSettingsTab
      canManageSettings={canManageSettings}
      settingsUnavailableReason={settingsManageUnavailableReason}
    />
  );

  const sectionRenderers: Record<PlatformSettingsSection, () => React.ReactNode> = {
    git: renderGit,
    projects: renderProjects,
    'invite-domains': renderInviteDomains,
    'pii-redaction': renderPiiRedaction,
    engines: renderEngines,
    'identity-providers': renderIdentityProviders,
    'identity-mappings': renderIdentityMappings,
    configuration: renderConfiguration,
    'role-library': renderRoleLibrary,
    'access-control': renderAccessControl,
    'authz-policies': renderAuthzPolicies,
    'authz-audit': renderAuthzAudit,
    'audit-logs': renderAuditLogs,
    email: renderEmail,
    'email-templates': renderEmailTemplates,
    branding: renderBranding,
  };
  const platformSettingsTabs = PLATFORM_SETTINGS_SECTION_REGISTRY
    .filter((tab) => sectionVisibility[tab.visibility])
    .map((tab) => ({ ...tab, render: sectionRenderers[tab.id] }));

  const selectedSectionTab = section
    ? platformSettingsTabs.find((tab) => tab.id === section)
    : null;

  const normalizedInviteDomains = Array.isArray((settings as any)?.inviteAllowedDomains)
    ? ((settings as any).inviteAllowedDomains as string[]).map((d) => String(d || '').trim().toLowerCase()).filter(Boolean)
    : [];

  const inviteAllowAll = (settings as any)?.inviteAllowAllDomains ?? true;

  const addInviteDomain = () => {
    if (!canManageSettings) return;
    const raw = String(inviteDomainInput || '').trim().toLowerCase();
    if (!raw) return;
    const domain = raw.includes('@') ? raw.split('@').pop() || '' : raw;
    const cleaned = domain.replace(/^\.+/, '').replace(/\.+$/, '');
    if (!cleaned) return;
    const next = Array.from(new Set([...(normalizedInviteDomains || []), cleaned]));
    updateSettings.mutate({ inviteAllowedDomains: next } as any);
    setInviteDomainInput('');
  };

  const removeInviteDomain = (domain: string) => {
    if (!canManageSettings) return;
    const next = (normalizedInviteDomains || []).filter((d) => d !== domain);
    updateSettings.mutate({ inviteAllowedDomains: next } as any);
  };

  if (isLoading) {
    return (
      <PageLayout
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--spacing-5)',
          background: 'var(--color-bg-primary)',
          minHeight: '100vh',
        }}
      >
        <PageHeader
          icon={Settings}
          title="Platform Settings"
          subtitle="Configure global platform behavior and defaults"
          gradient={PAGE_GRADIENTS.red}
        />
        <div style={{ padding: 'var(--spacing-5)' }}>
          <div style={{ display: 'flex', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-6)' }}>
            <SkeletonText width="70px" />
            <SkeletonText width="80px" />
            <SkeletonText width="90px" />
          </div>
          <SkeletonText heading width="240px" />
          <div style={{ marginTop: 'var(--spacing-3)' }}>
            <SkeletonText paragraph lineCount={3} />
          </div>
          <div style={{ marginTop: 'var(--spacing-6)' }}>
            <SkeletonText paragraph lineCount={6} />
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout>
        <InlineNotification
          kind="error"
          title="Error"
          subtitle="Failed to load platform settings"
          hideCloseButton
        />
      </PageLayout>
    );
  }

  if (!canViewPlatformSettingsHub) {
    return (
      <PageLayout
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--spacing-5)',
          background: 'var(--color-bg-primary)',
          minHeight: '100vh',
        }}
      >
        <PageHeader
          icon={Settings}
          title={headerTitle}
          subtitle={headerSubtitle}
          gradient={PAGE_GRADIENTS.red}
        />
        <div style={{ padding: 'var(--spacing-5)' }}>
          <InlineNotification
            kind="error"
            title="Platform settings unavailable"
            subtitle="No Platform Settings or platform administration permissions are available for the current user."
            hideCloseButton
          />
        </div>
      </PageLayout>
    );
  }

  if (platformSettingsTabs.length === 0) {
    return (
      <PageLayout
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--spacing-5)',
          background: 'var(--color-bg-primary)',
          minHeight: '100vh',
        }}
      >
        <PageHeader
          icon={Settings}
          title={headerTitle}
          subtitle={headerSubtitle}
          gradient={PAGE_GRADIENTS.red}
        />
        <div style={{ padding: 'var(--spacing-5)' }}>
          <InlineNotification
            kind="info"
            title="No available settings tabs"
            subtitle={settingsReadUnavailableReason || 'No tab permissions are available for the current user.'}
            hideCloseButton
          />
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-5)',
        background: 'var(--color-bg-primary)',
        minHeight: '100vh',
      }}
    >
      <PageHeader
        icon={Settings}
        title={headerTitle}
        subtitle={headerSubtitle}
        gradient={PAGE_GRADIENTS.red}
      />

      {section ? (
        <div style={{ paddingInline: 0, paddingBlock: 'var(--cds-layout-density-padding-inline-local)' }}>
          {selectedSectionTab ? selectedSectionTab.render() : (
            <InlineNotification
              kind="error"
              title="Settings tab unavailable"
              subtitle="The current user does not have permission to open this Platform Settings tab."
              hideCloseButton
            />
          )}
        </div>
      ) : (
        <Tabs>
          <TabList aria-label="Platform settings tabs">
            {platformSettingsTabs.map((tab) => (
              <Tab key={tab.id}>{tab.label}</Tab>
            ))}
          </TabList>
          <TabPanels>
            {platformSettingsTabs.map((tab) => (
              <TabPanel
                key={tab.id}
                style={{
                  paddingInline: 0,
                  paddingBlock: 'var(--cds-layout-density-padding-inline-local)',
                }}
              >
                {tab.render()}
              </TabPanel>
            ))}
          </TabPanels>
        </Tabs>
      )}

      {/* Create Environment Modal */}
      <Modal
        open={createModalOpen}
        onRequestClose={() => setCreateModalOpen(false)}
        modalHeading="Create Environment"
        primaryButtonText="Create"
        secondaryButtonText="Cancel"
        onRequestSubmit={handleCreateTag}
        primaryButtonDisabled={!formName.trim() || createTag.isPending || !canManageSettings}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', paddingTop: 'var(--spacing-4)' }}>
          <TextInput
            id="tag-name"
            labelText="Name"
            placeholder="e.g., Development"
            value={formName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormName(e.target.value)}
            disabled={!canManageSettings}
          />
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-2)', fontSize: '12px', fontWeight: 500 }}>Color</label>
            <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    if (canManageSettings) setFormColor(c);
                  }}
                  disabled={!canManageSettings}
                  style={{ width: 28, height: 28, borderRadius: 4, background: c, border: formColor === c ? '3px solid var(--color-text-primary)' : '2px solid transparent', cursor: canManageSettings ? 'pointer' : 'default' }}
                />
              ))}
            </div>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-2)', fontSize: '12px', fontWeight: 500 }}>Deployment Mode</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="deploy-mode"
                  checked={!formManualDeploy}
                  onChange={() => setFormManualDeploy(false)}
                  disabled={!canManageSettings}
                  style={{ cursor: canManageSettings ? 'pointer' : 'default' }}
                />
                <span style={{ fontSize: '14px' }}>CI/CD Only</span>
                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>— Deployments only via pipelines</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="deploy-mode"
                  checked={formManualDeploy}
                  onChange={() => setFormManualDeploy(true)}
                  disabled={!canManageSettings}
                  style={{ cursor: canManageSettings ? 'pointer' : 'default' }}
                />
                <span style={{ fontSize: '14px' }}>Manual Allowed</span>
                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>— Users can trigger deployments manually</span>
              </label>
            </div>
          </div>
        </div>
      </Modal>

      {/* Edit Environment Modal */}
      <Modal
        open={!!editingTag}
        onRequestClose={() => setEditingTag(null)}
        modalHeading={`Edit ${editingTag?.name || ''}`}
        primaryButtonText="Save"
        secondaryButtonText="Cancel"
        onRequestSubmit={handleUpdateTag}
        primaryButtonDisabled={!formName.trim() || updateTag.isPending || !canManageSettings}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', paddingTop: 'var(--spacing-4)' }}>
          <TextInput
            id="edit-tag-name"
            labelText="Name"
            value={formName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormName(e.target.value)}
            disabled={!canManageSettings}
          />
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-2)', fontSize: '12px', fontWeight: 500 }}>Color</label>
            <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    if (canManageSettings) setFormColor(c);
                  }}
                  disabled={!canManageSettings}
                  style={{ width: 28, height: 28, borderRadius: 4, background: c, border: formColor === c ? '3px solid var(--color-text-primary)' : '2px solid transparent', cursor: canManageSettings ? 'pointer' : 'default' }}
                />
              ))}
            </div>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-2)', fontSize: '12px', fontWeight: 500 }}>Deployment Mode</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="edit-deploy-mode"
                  checked={!formManualDeploy}
                  onChange={() => setFormManualDeploy(false)}
                  disabled={!canManageSettings}
                  style={{ cursor: canManageSettings ? 'pointer' : 'default' }}
                />
                <span style={{ fontSize: '14px' }}>CI/CD Only</span>
                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>— Deployments only via pipelines</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="edit-deploy-mode"
                  checked={formManualDeploy}
                  onChange={() => setFormManualDeploy(true)}
                  disabled={!canManageSettings}
                  style={{ cursor: canManageSettings ? 'pointer' : 'default' }}
                />
                <span style={{ fontSize: '14px' }}>Manual Allowed</span>
                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>— Users can trigger deployments manually</span>
              </label>
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deleteConfirmTag}
        onRequestClose={() => setDeleteConfirmTag(null)}
        modalHeading="Delete Environment"
        primaryButtonText="Delete"
        secondaryButtonText="Cancel"
        danger
        onRequestSubmit={handleDeleteTag}
        primaryButtonDisabled={deleteTag.isPending || !canManageSettings}
      >
        <p>Are you sure you want to delete <strong>{deleteConfirmTag?.name}</strong>? This may affect engines using this environment.</p>
      </Modal>

      {/* Assign Owner/Delegate Modal */}
      <Modal
        open={!!assignModalType}
        onRequestClose={closeAssignModal}
        modalHeading={
          assignModalType === 'projectOwner' ? `Assign Owner to ${assignTarget?.name}` :
          assignModalType === 'projectDelegate' ? `Assign Delegate to ${assignTarget?.name}` :
          assignModalType === 'engineOwner' ? `Assign Owner to ${assignTarget?.name}` :
          `Assign Delegate to ${assignTarget?.name}`
        }
        primaryButtonText={isAssigning ? 'Assigning...' : 'Assign'}
        secondaryButtonText="Cancel"
        onRequestSubmit={handleAssign}
        primaryButtonDisabled={!selectedUser || !assignReason.trim() || isAssigning || !canManageGovernance}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', paddingTop: 'var(--spacing-4)' }}>
          <ComboBox
            key={`user-combo-${userComboKey}`}
            id="user-combobox"
            titleText="Select User"
            placeholder="Find a user..."
            items={allUsers || []}
            itemToString={(item: UserListItem | null) =>
              item ? `${item.firstName || ''} ${item.lastName || ''} (${item.email})`.trim() : ''
            }
            selectedItem={selectedUser}
            disabled={!canManageGovernance}
            onChange={({ selectedItem }: { selectedItem?: UserListItem | null }) => {
              setSelectedUser(selectedItem ?? null);
            }}
            shouldFilterItem={({ item, inputValue }: { item: UserListItem; inputValue: string | null }) => {
              const searchValue = (inputValue ?? '').toLowerCase();
              if (!searchValue) return true;
              const search = searchValue;
              return (
                item.email.toLowerCase().includes(search) ||
                (item.firstName?.toLowerCase() || '').includes(search) ||
                (item.lastName?.toLowerCase() || '').includes(search)
              );
            }}
            size="md"
          />

          <TextArea
            id="assign-reason"
            labelText="Reason (required)"
            placeholder="e.g., Employee departure, project transfer..."
            value={assignReason}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAssignReason(e.target.value)}
            rows={3}
            disabled={!canManageGovernance}
          />
        </div>
      </Modal>
    </PageLayout>
  );
}
