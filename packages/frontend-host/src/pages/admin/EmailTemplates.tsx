import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DataTable,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
  DataTableSkeleton,
  Button,
  TextInput,
  TextArea,
  Toggle,
  Tag,
  Modal,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  InlineNotification,
} from '@carbon/react';
import { Email, Edit, View, Reset } from '@carbon/icons-react';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../shared/components/PageLayout';
import { apiClient } from '../../shared/api/client';
import { fetchList } from '../../shared/api/fetchList';
import { parseApiError } from '../../shared/api/apiErrorUtils';
import { useToast } from '../../shared/notifications/ToastProvider';
import { configurationOwnershipDescription, configurationOwnershipLabel } from '../../features/platform-admin/identityAccessCopy';

interface EmailTemplate {
  id: string;
  type: string;
  name: string;
  subject: string;
  htmlTemplate: string;
  textTemplate: string | null;
  variables: string[];
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  configKey: string | null;
  sourceRef: string | null;
  ownershipMode: 'manual' | 'config_locked' | 'config_warn';
  driftStatus: 'in_sync' | 'drifted' | null;
}

interface SettingsSectionOwnership {
  section: string;
  sourceRef: string | null;
  ownershipMode: 'manual' | 'config_locked' | 'config_warn';
  driftStatus: 'in_sync' | 'drifted' | null;
}

const isConfigLocked = (template: EmailTemplate | null | undefined) => template?.ownershipMode === 'config_locked';

const TYPE_LABELS: Record<string, string> = {
  invite: 'User Invitation',
  password_reset: 'Password Reset',
  welcome: 'Welcome Email',
  email_verification: 'Email Verification',
};

const tableHeaders = [
  { key: 'name', header: 'Template Name' },
  { key: 'type', header: 'Type' },
  { key: 'subject', header: 'Subject' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

interface EmailTemplatesProps {
  embedded?: boolean;
  canManageSettings?: boolean;
  settingsUnavailableReason?: string | null;
}

export default function EmailTemplates({
  embedded,
  canManageSettings = true,
  settingsUnavailableReason,
}: EmailTemplatesProps = {}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null);
  const [previewData, setPreviewData] = useState<{ subject: string; html: string; text: string } | null>(null);
  const [emailPlatformName, setEmailPlatformName] = useState('');
  const [platformNameError, setPlatformNameError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    subject: '',
    htmlTemplate: '',
    textTemplate: '',
    isActive: true,
  });
  const disabledReason = settingsUnavailableReason || 'Missing permission platform:settings:manage';

  const platformNameQuery = useQuery({
    queryKey: ['email-platform-name'],
    queryFn: () => apiClient.get<{ emailPlatformName: string; ownership: SettingsSectionOwnership | null }>('/api/admin/email-platform-name'),
  });
  const platformNameOwnership = platformNameQuery.data?.ownership;
  const platformNameConfigLocked = platformNameOwnership?.ownershipMode === 'config_locked' && Boolean(platformNameOwnership.sourceRef);
  const canManagePlatformName = canManageSettings && !platformNameConfigLocked;
  const platformNameDisabledReason = platformNameConfigLocked
    ? configurationOwnershipDescription(platformNameOwnership.ownershipMode, platformNameOwnership.sourceRef)
    : disabledReason;

  const updatePlatformNameMutation = useMutation({
    mutationFn: (value: string) =>
      canManagePlatformName
        ? apiClient.put('/api/admin/email-platform-name', { emailPlatformName: value })
        : Promise.reject(new Error(platformNameDisabledReason)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-platform-name'] });
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      notify({ kind: 'success', title: 'Email platform name updated' });
      setPlatformNameError(null);
    },
    onError: (err: Error) => {
      const parsed = parseApiError(err, 'Failed to update email platform name');
      notify({ kind: 'error', title: 'Failed to update email platform name', subtitle: parsed.message });
    },
  });

  if (platformNameQuery.data && emailPlatformName === '') {
    const v = platformNameQuery.data.emailPlatformName;
    if (typeof v === 'string') setEmailPlatformName(v);
  }

  const templatesQuery = useQuery({
    queryKey: ['email-templates'],
    queryFn: () => fetchList<EmailTemplate>('/api/admin/email-templates'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      canManageSettings
        ? apiClient.patch(`/api/admin/email-templates/${id}`, data)
        : Promise.reject(new Error(disabledReason)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      setEditingTemplate(null);
      notify({ kind: 'success', title: 'Template updated' });
    },
    onError: (err: Error) => {
      const parsed = parseApiError(err, 'Failed to update template');
      notify({ kind: 'error', title: 'Failed to update template', subtitle: parsed.message });
    },
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) =>
      canManageSettings
        ? apiClient.post(`/api/admin/email-templates/${id}/reset`)
        : Promise.reject(new Error(disabledReason)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      notify({ kind: 'success', title: 'Template reset' });
    },
    onError: (err: Error) => {
      const parsed = parseApiError(err, 'Failed to reset template');
      notify({ kind: 'error', title: 'Failed to reset template', subtitle: parsed.message });
    },
  });

  const previewMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ subject: string; html: string; text: string }>(`/api/admin/email-templates/${id}/preview`, {}),
    onSuccess: (data) => {
      setPreviewData(data);
    },
    onError: (err: Error) => {
      const parsed = parseApiError(err, 'Failed to load preview');
      notify({ kind: 'error', title: 'Failed to load preview', subtitle: parsed.message });
    },
  });

  const openEditModal = (template: EmailTemplate) => {
    if (isConfigLocked(template)) return;
    setFormData({
      name: template.name,
      subject: template.subject,
      htmlTemplate: template.htmlTemplate,
      textTemplate: template.textTemplate || '',
      isActive: template.isActive,
    });
    setEditingTemplate(template);
  };

  const openPreviewModal = (template: EmailTemplate) => {
    setPreviewTemplate(template);
    previewMutation.mutate(template.id);
  };

  const tableRows = (templatesQuery.data || []).map((template) => ({
    id: template.id,
    name: template.name,
    type: TYPE_LABELS[template.type] || template.type,
    subject: template.subject.length > 50 ? template.subject.substring(0, 50) + '...' : template.subject,
    status: template,
    actions: template,
  }));

  const content = (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 'var(--spacing-3)',
          flexWrap: 'wrap',
        }}
      >
        {!canManageSettings && (
          <InlineNotification
            kind="warning"
            title="Email templates are read-only"
            subtitle={disabledReason}
            hideCloseButton
            lowContrast
            style={{ flexBasis: '100%' }}
          />
        )}
        {platformNameConfigLocked && (
          <InlineNotification
            kind="info"
            title="Email platform name is managed by configuration"
            subtitle={platformNameDisabledReason}
            hideCloseButton
            lowContrast
            style={{ flexBasis: '100%' }}
          />
        )}
        <TextInput
          id="email-platform-name"
          labelText="Email Platform Name"
          value={emailPlatformName}
          maxLength={160}
          onChange={(e) => setEmailPlatformName(e.target.value)}
          disabled={!canManagePlatformName}
          style={{ minWidth: 320 }}
        />
        <Button
          kind="primary"
          size="md"
          onClick={() => {
            if (!canManagePlatformName) return;
            const v = emailPlatformName.trim();
            if (!v) {
              notify({ kind: 'error', title: 'Email platform name cannot be empty' });
              return;
            }
            updatePlatformNameMutation.mutate(v);
          }}
          disabled={!canManagePlatformName || platformNameQuery.isLoading || updatePlatformNameMutation.isPending}
          title={!canManagePlatformName ? platformNameDisabledReason : undefined}
        >
          {updatePlatformNameMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
      </div>

      <div style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', marginTop: 'var(--spacing-2)' }}>
        Used for the {'{{platformName}}'} variable in templates
      </div>

      {templatesQuery.isLoading ? (
        <DataTableSkeleton columnCount={5} rowCount={4} />
      ) : templatesQuery.error ? (
        <div />
      ) : (
        <DataTable rows={tableRows} headers={tableHeaders}>
          {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
            <TableContainer>
              <Table {...getTableProps()}>
                <TableHead>
                  <TableRow>
                    {headers.map((header) => {
                      const { key, ...rest } = getHeaderProps({ header });
                      return (
                        <TableHeader key={key} {...rest}>
                          {header.header}
                        </TableHeader>
                      );
                    })}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const { key, ...rest } = getRowProps({ row });
                    return (
                      <TableRow key={key} {...rest}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') {
                            const template = cell.value as EmailTemplate;
                            return (
                              <TableCell key={cell.id}>
                                <Tag type={template.isActive ? 'green' : 'gray'} size="sm">
                                  {template.isActive ? 'Active' : 'Inactive'}
                                </Tag>
                                {template.ownershipMode !== 'manual' && <Tag type={template.ownershipMode === 'config_warn' ? 'warm-gray' : 'purple'} size="sm" title={configurationOwnershipDescription(template.ownershipMode, template.sourceRef)}>{configurationOwnershipLabel(template.ownershipMode)}</Tag>}
                                {template.driftStatus === 'drifted' && <Tag type="red" size="sm">Drifted</Tag>}
                              </TableCell>
                            );
                          }
                          if (cell.info.header === 'actions') {
                            const template = cell.value as EmailTemplate;
                            return (
                              <TableCell key={cell.id}>
                                <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
                                  <Button
                                    kind="ghost"
                                    size="sm"
                                    hasIconOnly
                                    renderIcon={View}
                                    iconDescription="Preview"
                                    onClick={() => openPreviewModal(template)}
                                  />
                                  <Button
                                    kind="ghost"
                                    size="sm"
                                    hasIconOnly
                                    renderIcon={Edit}
                                    iconDescription="Edit"
                                    disabled={!canManageSettings || isConfigLocked(template)}
                                    title={isConfigLocked(template) ? configurationOwnershipDescription(template.ownershipMode, template.sourceRef) : !canManageSettings ? disabledReason : undefined}
                                    onClick={() => openEditModal(template)}
                                  />
                                  <Button
                                    kind="ghost"
                                    size="sm"
                                    hasIconOnly
                                    renderIcon={Reset}
                                    iconDescription="Reset to Default"
                                    disabled={!canManageSettings || isConfigLocked(template)}
                                    title={isConfigLocked(template) ? configurationOwnershipDescription(template.ownershipMode, template.sourceRef) : !canManageSettings ? disabledReason : undefined}
                                    onClick={() => {
                                      if (!canManageSettings) return;
                                      if (confirm('Reset this template to its default content?')) {
                                        resetMutation.mutate(template.id);
                                      }
                                    }}
                                  />
                                </div>
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DataTable>
      )}

      {/* Edit Modal */}
      <Modal
        open={!!editingTemplate}
        onRequestClose={() => setEditingTemplate(null)}
        modalHeading={`Edit Template: ${editingTemplate?.name}`}
        primaryButtonText="Save"
        secondaryButtonText="Cancel"
        onRequestSubmit={() => {
          if (canManageSettings && editingTemplate) {
            updateMutation.mutate({ id: editingTemplate.id, data: formData });
          }
        }}
        primaryButtonDisabled={!canManageSettings || updateMutation.isPending || isConfigLocked(editingTemplate)}
        size="lg"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          {!canManageSettings && (
            <InlineNotification kind="warning" title="Email templates are read-only" subtitle={disabledReason} hideCloseButton lowContrast />
          )}
          {isConfigLocked(editingTemplate) && (
            <InlineNotification kind="info" title="Managed by configuration" subtitle={configurationOwnershipDescription(editingTemplate?.ownershipMode, editingTemplate?.sourceRef)} hideCloseButton lowContrast />
          )}
          <TextInput
            id="template-name"
            labelText="Template Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            disabled={!canManageSettings}
          />
          <TextInput
            id="template-subject"
            labelText="Email Subject"
            value={formData.subject}
            onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
            helperText="Use {{variableName}} for dynamic values"
            disabled={!canManageSettings}
          />
          {editingTemplate && (
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
              <strong>Available variables:</strong> {editingTemplate.variables.map(v => `{{${v}}}`).join(', ')}
            </div>
          )}
          <TextArea
            id="template-html"
            labelText="HTML Template"
            value={formData.htmlTemplate}
            onChange={(e) => setFormData({ ...formData, htmlTemplate: e.target.value })}
            rows={10}
            disabled={!canManageSettings}
          />
          <TextArea
            id="template-text"
            labelText="Plain Text Template (optional)"
            value={formData.textTemplate}
            onChange={(e) => setFormData({ ...formData, textTemplate: e.target.value })}
            rows={5}
            disabled={!canManageSettings}
          />
          <Toggle
            id="template-active"
            labelText="Active"
            toggled={formData.isActive}
            onToggle={(checked) => setFormData({ ...formData, isActive: checked })}
            disabled={!canManageSettings}
          />
        </div>
      </Modal>

      {/* Preview Modal */}
      <Modal
        open={!!previewTemplate}
        onRequestClose={() => {
          setPreviewTemplate(null);
          setPreviewData(null);
        }}
        modalHeading={`Preview: ${previewTemplate?.name}`}
        passiveModal
        size="lg"
      >
        {previewMutation.isPending ? (
          <p>Loading preview...</p>
        ) : previewData ? (
          <Tabs>
            <TabList aria-label="Preview tabs">
              <Tab>HTML</Tab>
              <Tab>Plain Text</Tab>
            </TabList>
            <TabPanels>
              <TabPanel>
                <div style={{ marginBottom: 'var(--spacing-3)' }}>
                  <strong>Subject:</strong> {previewData.subject}
                </div>
                <iframe
                  srcDoc={previewData.html}
                  sandbox=""
                  style={{
                    border: '1px solid var(--cds-border-subtle)',
                    padding: 0,
                    background: 'white',
                    borderRadius: '4px',
                    width: '100%',
                    minHeight: '400px',
                  }}
                  title="Email template preview"
                />
              </TabPanel>
              <TabPanel>
                <div style={{ marginBottom: 'var(--spacing-3)' }}>
                  <strong>Subject:</strong> {previewData.subject}
                </div>
                <pre
                  style={{
                    border: '1px solid var(--cds-border-subtle)',
                    padding: 'var(--spacing-4)',
                    background: 'var(--cds-layer-01)',
                    borderRadius: '4px',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'monospace',
                  }}
                >
                  {previewData.text}
                </pre>
              </TabPanel>
            </TabPanels>
          </Tabs>
        ) : null}
      </Modal>
    </>
  );

  if (embedded) return content;

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
        icon={Email}
        title="Email Templates"
        subtitle="Manage email templates for invitations, password resets, and notifications"
        gradient={PAGE_GRADIENTS.purple}
      />
      {content}
    </PageLayout>
  );
}
