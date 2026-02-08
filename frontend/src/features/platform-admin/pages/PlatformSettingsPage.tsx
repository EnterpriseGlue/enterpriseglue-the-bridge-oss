import React, { useState } from 'react';
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
import type { EnvironmentTag, ProjectGovernanceItem, EngineGovernanceItem, UserListItem } from '../../../api/platform-admin';
import SsoSettingsTab from '../components/SsoSettingsTab';
import { GitSettingsSection } from '../components/GitSettingsSection';
import { ProjectsSettingsSection } from '../components/ProjectsSettingsSection';
import { InviteDomainsSettingsSection } from '../components/InviteDomainsSettingsSection';
import { EnginesSettingsSection } from '../components/EnginesSettingsSection';
import EmailConfigurations from '../../../pages/admin/EmailConfigurations';
import EmailTemplates from '../../../pages/admin/EmailTemplates';
import BrandingSettingsTab from '../components/BrandingSettingsTab';

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

type PlatformSettingsSection = 'git' | 'projects' | 'invite-domains' | 'engines' | 'sso' | 'email' | 'email-templates' | 'branding';

interface PlatformSettingsPageProps {
  section?: PlatformSettingsSection;
}

export default function PlatformSettingsPage({ section }: PlatformSettingsPageProps) {
  const { data: settings, isLoading, error } = usePlatformSettings();
  const { data: envTags, isLoading: envLoading } = useEnvironmentTags();
  const { data: gitProviders, isLoading: gitProvidersLoading } = useAdminGitProviders();
  const updateSettings = useUpdatePlatformSettings();
  const updateGitProvider = useUpdateGitProvider();
  const createTag = useCreateEnvironmentTag();
  const updateTag = useUpdateEnvironmentTag();
  const deleteTag = useDeleteEnvironmentTag();
  const reorderTags = useReorderEnvironmentTags();

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
  const { data: allProjects, isLoading: projectsLoading } = useProjectsGovernance(undefined);
  const { data: allEngines, isLoading: enginesLoading } = useEnginesGovernance(undefined);
  const { data: allUsers } = useAdminUsers({ limit: 100 });
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
    resetForm();
    setCreateModalOpen(true);
  };

  const openEditModal = (tag: EnvironmentTag) => {
    setFormName(tag.name);
    setFormColor(tag.color);
    setFormManualDeploy(tag.manualDeployAllowed);
    setEditingTag(tag);
  };

  const handleCreateTag = () => {
    createTag.mutate(
      { name: formName, color: formColor, manualDeployAllowed: formManualDeploy },
      { onSuccess: () => { setCreateModalOpen(false); resetForm(); } }
    );
  };

  const handleUpdateTag = () => {
    if (!editingTag) return;
    updateTag.mutate(
      { id: editingTag.id, name: formName, color: formColor, manualDeployAllowed: formManualDeploy },
      { onSuccess: () => { setEditingTag(null); resetForm(); } }
    );
  };

  const handleDeleteTag = () => {
    if (!deleteConfirmTag) return;
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
    if (!draggedTagId || draggedTagId === targetTagId || !envTags) return;

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
    if (!assignTarget || !selectedUser || !assignReason.trim()) return;

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
    updateSettings.mutate({ [key]: value });
  };

  const handleDeployRoleToggle = (role: string, checked: boolean) => {
    if (!settings) return;
    const current = Array.isArray(settings.defaultDeployRoles) ? settings.defaultDeployRoles : [];
    const updated = checked
      ? [...current, role]
      : current.filter((r: string) => r !== role);
    updateSettings.mutate({ defaultDeployRoles: updated });
  };

  const headerTitle = section
    ? `${section.charAt(0).toUpperCase()}${section.slice(1)} Settings`
    : 'Platform Settings';
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
        await updateGitProvider.mutateAsync({ id, updates });
      }}
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
      onToggleInviteAllowAll={(checked) => updateSettings.mutate({ inviteAllowAllDomains: checked } as any)}
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
    />
  );

  const renderSso = () => <SsoSettingsTab />;

  const renderEmail = () => <EmailConfigurations embedded />;

  const renderEmailTemplates = () => <EmailTemplates embedded />;

  const renderBranding = () => <BrandingSettingsTab />;

  const renderSection = () => {
    switch (section) {
      case 'git':
        return renderGit();
      case 'projects':
        return renderProjects();
      case 'invite-domains':
        return renderInviteDomains();
      case 'engines':
        return renderEngines();
      case 'sso':
        return renderSso();
      case 'email':
        return renderEmail();
      case 'email-templates':
        return renderEmailTemplates();
      case 'branding':
        return renderBranding();
      default:
        return null;
    }
  };

  const normalizedInviteDomains = Array.isArray((settings as any)?.inviteAllowedDomains)
    ? ((settings as any).inviteAllowedDomains as string[]).map((d) => String(d || '').trim().toLowerCase()).filter(Boolean)
    : [];

  const inviteAllowAll = (settings as any)?.inviteAllowAllDomains ?? true;

  const addInviteDomain = () => {
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
          {renderSection()}
        </div>
      ) : (
        <Tabs>
          <TabList aria-label="Platform settings tabs">
            <Tab>Git</Tab>
            <Tab>Projects</Tab>
            <Tab>Engines</Tab>
            <Tab>SSO</Tab>
            <Tab>Invite Domains</Tab>
            <Tab>Email</Tab>
            <Tab>Email Templates</Tab>
            <Tab>Branding</Tab>
          </TabList>
          <TabPanels>
            {/* Tab 1: Git */}
            <TabPanel
              style={{
                paddingInline: 0,
                paddingBlock: 'var(--cds-layout-density-padding-inline-local)',
              }}
            >
              {renderGit()}
            </TabPanel>

            {/* Tab 2: Projects */}
            <TabPanel
              style={{
                paddingInline: 0,
                paddingBlock: 'var(--cds-layout-density-padding-inline-local)',
              }}
            >
              {renderProjects()}
            </TabPanel>

            {/* Tab 3: Engines */}
            <TabPanel
              style={{
                paddingInline: 0,
                paddingBlock: 'var(--cds-layout-density-padding-inline-local)',
              }}
            >
              {renderEngines()}
            </TabPanel>

            {/* Tab 4: SSO */}
            <TabPanel
              style={{
                paddingInline: 0,
                paddingBlock: 'var(--cds-layout-density-padding-inline-local)',
              }}
            >
              {renderSso()}
            </TabPanel>

            {/* Tab 5: Invite Domains */}
            <TabPanel
              style={{
                paddingInline: 0,
                paddingBlock: 'var(--cds-layout-density-padding-inline-local)',
              }}
            >
              {renderInviteDomains()}
            </TabPanel>

            {/* Tab 6: Email */}
            <TabPanel
              style={{
                paddingInline: 0,
                paddingBlock: 'var(--cds-layout-density-padding-inline-local)',
              }}
            >
              {renderEmail()}
            </TabPanel>

            {/* Tab 7: Email Templates */}
            <TabPanel
              style={{
                paddingInline: 0,
                paddingBlock: 'var(--cds-layout-density-padding-inline-local)',
              }}
            >
              {renderEmailTemplates()}
            </TabPanel>

            {/* Tab 8: Branding */}
            <TabPanel
              style={{
                paddingInline: 0,
                paddingBlock: 'var(--cds-layout-density-padding-inline-local)',
              }}
            >
              {renderBranding()}
            </TabPanel>
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
        primaryButtonDisabled={!formName.trim() || createTag.isPending}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', paddingTop: 'var(--spacing-4)' }}>
          <TextInput
            id="tag-name"
            labelText="Name"
            placeholder="e.g., Development"
            value={formName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormName(e.target.value)}
          />
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-2)', fontSize: '12px', fontWeight: 500 }}>Color</label>
            <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
              {TAG_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setFormColor(c)} style={{ width: 28, height: 28, borderRadius: 4, background: c, border: formColor === c ? '3px solid var(--color-text-primary)' : '2px solid transparent', cursor: 'pointer' }} />
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
                  style={{ cursor: 'pointer' }}
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
                  style={{ cursor: 'pointer' }}
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
        primaryButtonDisabled={!formName.trim() || updateTag.isPending}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', paddingTop: 'var(--spacing-4)' }}>
          <TextInput
            id="edit-tag-name"
            labelText="Name"
            value={formName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormName(e.target.value)}
          />
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-2)', fontSize: '12px', fontWeight: 500 }}>Color</label>
            <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
              {TAG_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setFormColor(c)} style={{ width: 28, height: 28, borderRadius: 4, background: c, border: formColor === c ? '3px solid var(--color-text-primary)' : '2px solid transparent', cursor: 'pointer' }} />
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
                  style={{ cursor: 'pointer' }}
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
                  style={{ cursor: 'pointer' }}
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
        primaryButtonDisabled={deleteTag.isPending}
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
        primaryButtonDisabled={!selectedUser || !assignReason.trim() || isAssigning}
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
          />
        </div>
      </Modal>
    </PageLayout>
  );
}
