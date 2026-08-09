import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  DataTable,
  DataTableSkeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  Tag,
  TextInput,
  Select,
  SelectItem,
  Toggle,
  InlineNotification,
} from '@carbon/react';
import { Add, Email, Checkmark } from '@carbon/icons-react';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../shared/components/PageLayout';
import { GuardedOverflowMenu, GuardedOverflowMenuItem } from '../../shared/auth/guards';
import FormModal from '../../components/FormModal';
import ConfirmModal from '../../shared/components/ConfirmModal';
import { useModal } from '../../shared/hooks/useModal';
import { apiClient } from '../../shared/api/client';
import { parseApiError } from '../../shared/api/apiErrorUtils';
import { useToast } from '../../shared/notifications/ToastProvider';

interface EmailConfig {
  id: string;
  name: string;
  provider: 'resend' | 'sendgrid' | 'mailgun' | 'mailjet' | 'smtp';
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

const PROVIDER_LABELS: Record<string, string> = {
  resend: 'Resend',
  sendgrid: 'SendGrid',
  mailgun: 'Mailgun',
  mailjet: 'Mailjet',
  smtp: 'SMTP',
};

const tableHeaders = [
  { key: 'name', header: 'Name' },
  { key: 'provider', header: 'Provider' },
  { key: 'from', header: 'From' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

interface EmailConfigurationsProps {
  embedded?: boolean;
  canManageSettings?: boolean;
  settingsUnavailableReason?: string | null;
}

export default function EmailConfigurations({
  embedded,
  canManageSettings = true,
  settingsUnavailableReason,
}: EmailConfigurationsProps = {}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const createModal = useModal();
  const editModal = useModal<EmailConfig>();
  const deleteModal = useModal<EmailConfig>();
  const testModal = useModal<EmailConfig>();

  const [formData, setFormData] = useState<{
    name: string;
    provider: 'resend' | 'sendgrid' | 'mailgun' | 'mailjet' | 'smtp';
    apiKey: string;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    smtpHost: string;
    smtpPort: number | '';
    smtpSecure: boolean;
    smtpUser: string;
    enabled: boolean;
    isDefault: boolean;
  }>({
    name: '',
    provider: 'resend',
    apiKey: '',
    fromName: '',
    fromEmail: '',
    replyTo: '',
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: '',
    enabled: true,
    isDefault: false,
  });
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const disabledReason = settingsUnavailableReason || 'Missing permission platform:settings:manage';

  const configsQuery = useQuery({
    queryKey: ['email-configs'],
    queryFn: () => apiClient.get<EmailConfig[]>('/api/admin/email-configs'),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      canManageSettings
        ? apiClient.post('/api/admin/email-configs', data)
        : Promise.reject(new Error(disabledReason)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-configs'] });
      createModal.closeModal();
      resetForm();
      notify({ kind: 'success', title: 'Configuration created' });
    },
    onError: (err: Error) => {
      const parsed = parseApiError(err, 'Failed to create configuration');
      notify({ kind: 'error', title: 'Failed to create configuration', subtitle: parsed.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<typeof formData> }) =>
      canManageSettings
        ? apiClient.patch(`/api/admin/email-configs/${id}`, data)
        : Promise.reject(new Error(disabledReason)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-configs'] });
      editModal.closeModal();
      resetForm();
      notify({ kind: 'success', title: 'Configuration updated' });
    },
    onError: (err: Error) => {
      const parsed = parseApiError(err, 'Failed to update configuration');
      notify({ kind: 'error', title: 'Failed to update configuration', subtitle: parsed.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      canManageSettings
        ? apiClient.delete(`/api/admin/email-configs/${id}`)
        : Promise.reject(new Error(disabledReason)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-configs'] });
      deleteModal.closeModal();
      notify({ kind: 'success', title: 'Configuration deleted' });
    },
    onError: (err: Error) => {
      const parsed = parseApiError(err, 'Failed to delete configuration');
      notify({ kind: 'error', title: 'Failed to delete configuration', subtitle: parsed.message });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) =>
      canManageSettings
        ? apiClient.post(`/api/admin/email-configs/${id}/set-default`)
        : Promise.reject(new Error(disabledReason)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-configs'] });
      notify({ kind: 'success', title: 'Default configuration updated' });
    },
    onError: (err: Error) => {
      const parsed = parseApiError(err, 'Failed to update default');
      notify({ kind: 'error', title: 'Failed to update default', subtitle: parsed.message });
    },
  });

  const testMutation = useMutation({
    mutationFn: ({ id, toEmail }: { id: string; toEmail: string }) =>
      canManageSettings
        ? apiClient.post<{ success: boolean; message: string }>(`/api/admin/email-configs/${id}/test`, { toEmail })
        : Promise.reject(new Error(disabledReason)),
    onSuccess: () => {
      setTestResult({ success: true, message: 'Test email sent successfully!' });
    },
    onError: (err: Error) => {
      const parsed = parseApiError(err, 'Failed to send test email');
      setTestResult({ success: false, message: parsed.message });
      notify({ kind: 'error', title: 'Failed to send test email', subtitle: parsed.message });
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      provider: 'resend',
      apiKey: '',
      fromName: '',
      fromEmail: '',
      replyTo: '',
      smtpHost: '',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: '',
      enabled: true,
      isDefault: false,
    });
  };

  const openEditModal = (config: EmailConfig) => {
    setFormData({
      name: config.name,
      provider: config.provider,
      apiKey: '',
      fromName: config.fromName,
      fromEmail: config.fromEmail,
      replyTo: config.replyTo || '',
      smtpHost: config.smtpHost || '',
      smtpPort: config.smtpPort || 587,
      smtpSecure: config.smtpSecure ?? false,
      smtpUser: config.smtpUser || '',
      enabled: config.enabled,
      isDefault: config.isDefault,
    });
    editModal.openModal(config);
  };

  const openTestModal = (config: EmailConfig) => {
    setTestEmail('');
    setTestResult(null);
    testModal.openModal(config);
  };

  const tableRows = (configsQuery.data || []).map((config) => ({
    id: config.id,
    name: config.name,
    provider: PROVIDER_LABELS[config.provider] || config.provider,
    from: `${config.fromName} <${config.fromEmail}>`,
    status: config,
    actions: config,
  }));

  const content = (
    <>
      {configsQuery.isLoading ? (
        <DataTableSkeleton columnCount={5} rowCount={3} />
      ) : configsQuery.error ? (
        <div />
      ) : (
        <DataTable rows={tableRows} headers={tableHeaders}>
          {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
            <TableContainer>
              {!canManageSettings && (
                <InlineNotification
                  kind="warning"
                  title="Email settings are read-only"
                  subtitle={disabledReason}
                  hideCloseButton
                  lowContrast
                  style={{ marginBottom: 'var(--spacing-4)' }}
                />
              )}
              <TableToolbar>
                <TableToolbarContent>
                  <Button
                    kind="primary"
                    renderIcon={Add}
                    disabled={!canManageSettings}
                    title={!canManageSettings ? disabledReason : undefined}
                    onClick={() => {
                      if (!canManageSettings) return;
                      resetForm();
                      createModal.openModal();
                    }}
                  >
                    Add Configuration
                  </Button>
                </TableToolbarContent>
              </TableToolbar>
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
                    const config = row.cells.find((c) => c.info.header === 'status')?.value as EmailConfig;
                    return (
                      <TableRow key={key} {...rest}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') {
                            const cfg = cell.value as EmailConfig;
                            return (
                              <TableCell key={cell.id}>
                                <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
                                  {cfg.isDefault && <Tag type="blue" size="sm">Default</Tag>}
                                  {cfg.enabled ? (
                                    <Tag type="green" size="sm">Enabled</Tag>
                                  ) : (
                                    <Tag type="gray" size="sm">Disabled</Tag>
                                  )}
                                </div>
                              </TableCell>
                            );
                          }
                          if (cell.info.header === 'actions') {
                            const cfg = cell.value as EmailConfig;
                            return (
                              <TableCell key={cell.id}>
                                <GuardedOverflowMenu size="sm" flipped>
                                  <GuardedOverflowMenuItem itemText="Edit" unavailableReason={!canManageSettings ? disabledReason : null} onClick={() => openEditModal(cfg)} />
                                  <GuardedOverflowMenuItem itemText="Test Send" unavailableReason={!canManageSettings ? disabledReason : null} onClick={() => openTestModal(cfg)} />
                                  {!cfg.isDefault && (
                                    <GuardedOverflowMenuItem
                                      itemText="Set as Default"
                                      unavailableReason={!canManageSettings ? disabledReason : null}
                                      onClick={() => setDefaultMutation.mutate(cfg.id)}
                                    />
                                  )}
                                  {!cfg.isDefault && (
                                    <GuardedOverflowMenuItem
                                      itemText="Delete"
                                      isDelete
                                      unavailableReason={!canManageSettings ? disabledReason : null}
                                      onClick={() => deleteModal.openModal(cfg)}
                                    />
                                  )}
                                </GuardedOverflowMenu>
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

              {tableRows.length === 0 && !configsQuery.isLoading && (
                <div style={{ textAlign: 'center', padding: 'var(--spacing-7)', color: 'var(--color-text-secondary)' }}>
                  <Email size={48} style={{ marginBottom: 'var(--spacing-4)', opacity: 0.5 }} />
                  <p>No email configurations yet.</p>
                  <Button
                    kind="tertiary"
                    size="sm"
                    style={{ marginTop: 'var(--spacing-3)' }}
                    disabled={!canManageSettings}
                    title={!canManageSettings ? disabledReason : undefined}
                    onClick={() => {
                      if (!canManageSettings) return;
                      resetForm();
                      createModal.openModal();
                    }}
                  >
                    Add your first configuration
                  </Button>
                </div>
              )}
            </TableContainer>
          )}
        </DataTable>
      )}

      {/* Create Modal */}
      <FormModal
        open={createModal.isOpen}
        onClose={createModal.closeModal}
        onSubmit={() => createMutation.mutate(formData)}
        title="Add Email Configuration"
        submitText="Create"
        busy={createMutation.isPending}
        submitDisabled={!canManageSettings || !formData.name || !formData.apiKey || !formData.fromName || !formData.fromEmail}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          {!canManageSettings && (
            <InlineNotification kind="warning" title="Email settings are read-only" subtitle={disabledReason} hideCloseButton lowContrast />
          )}
          <TextInput
            id="name"
            labelText="Configuration Name"
            placeholder="e.g., Production Resend"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            disabled={!canManageSettings}
          />
          <Select
            id="provider"
            labelText="Provider"
            value={formData.provider}
            onChange={(e) => setFormData({ ...formData, provider: e.target.value as any })}
            disabled={!canManageSettings}
          >
            <SelectItem value="resend" text="Resend" />
            <SelectItem value="sendgrid" text="SendGrid" />
            <SelectItem value="mailgun" text="Mailgun" />
            <SelectItem value="mailjet" text="Mailjet" />
            <SelectItem value="smtp" text="SMTP" />
          </Select>
          {formData.provider === 'smtp' ? (
            <>
              <TextInput
                id="smtpHost"
                labelText="SMTP Host"
                placeholder="e.g., smtp.gmail.com"
                value={formData.smtpHost}
                onChange={(e) => setFormData({ ...formData, smtpHost: e.target.value })}
                disabled={!canManageSettings}
              />
              <TextInput
                id="smtpPort"
                labelText="SMTP Port"
                type="number"
                placeholder="587"
                value={formData.smtpPort}
                onChange={(e) => setFormData({ ...formData, smtpPort: e.target.value ? parseInt(e.target.value) : '' })}
                disabled={!canManageSettings}
              />
              <TextInput
                id="smtpUser"
                labelText="SMTP Username (optional, defaults to From Email)"
                placeholder="e.g., user@example.com"
                value={formData.smtpUser}
                onChange={(e) => setFormData({ ...formData, smtpUser: e.target.value })}
                disabled={!canManageSettings}
              />
              <TextInput
                id="apiKey"
                labelText="SMTP Password"
                type="password"
                placeholder="Enter your SMTP password"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                disabled={!canManageSettings}
              />
              <Toggle
                id="smtpSecure"
                labelText="Use TLS/SSL"
                toggled={formData.smtpSecure}
                onToggle={(checked) => setFormData({ ...formData, smtpSecure: checked })}
                disabled={!canManageSettings}
              />
            </>
          ) : (
            <TextInput
              id="apiKey"
              labelText="API Key"
              type="password"
              placeholder="Enter your API key"
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              disabled={!canManageSettings}
            />
          )}
          <TextInput
            id="fromName"
            labelText="From Name"
            placeholder="e.g., EnterpriseGlue"
            value={formData.fromName}
            onChange={(e) => setFormData({ ...formData, fromName: e.target.value })}
            disabled={!canManageSettings}
          />
          <TextInput
            id="fromEmail"
            labelText="From Email"
            type="email"
            placeholder="e.g., noreply@example.com"
            value={formData.fromEmail}
            onChange={(e) => setFormData({ ...formData, fromEmail: e.target.value })}
            disabled={!canManageSettings}
          />
          <TextInput
            id="replyTo"
            labelText="Reply-To Email (optional)"
            type="email"
            placeholder="e.g., support@example.com"
            value={formData.replyTo}
            onChange={(e) => setFormData({ ...formData, replyTo: e.target.value })}
            disabled={!canManageSettings}
          />
          <Toggle
            id="enabled"
            labelText="Enabled"
            toggled={formData.enabled}
            onToggle={(checked) => setFormData({ ...formData, enabled: checked })}
            disabled={!canManageSettings}
          />
          <Toggle
            id="isDefault"
            labelText="Set as Default"
            toggled={formData.isDefault}
            onToggle={(checked) => setFormData({ ...formData, isDefault: checked })}
            disabled={!canManageSettings}
          />
        </div>
      </FormModal>

      {/* Edit Modal */}
      <FormModal
        open={editModal.isOpen}
        onClose={editModal.closeModal}
        onSubmit={() => {
          if (!editModal.data) return;
          const updateData: any = { ...formData };
          if (!updateData.apiKey) delete updateData.apiKey;
          updateMutation.mutate({ id: editModal.data.id, data: updateData });
        }}
        title="Edit Email Configuration"
        submitText="Save"
        busy={updateMutation.isPending}
        submitDisabled={!canManageSettings || !formData.name || !formData.fromName || !formData.fromEmail}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          {!canManageSettings && (
            <InlineNotification kind="warning" title="Email settings are read-only" subtitle={disabledReason} hideCloseButton lowContrast />
          )}
          <TextInput
            id="edit-name"
            labelText="Configuration Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            disabled={!canManageSettings}
          />
          <Select
            id="edit-provider"
            labelText="Provider"
            value={formData.provider}
            onChange={(e) => setFormData({ ...formData, provider: e.target.value as any })}
            disabled={!canManageSettings}
          >
            <SelectItem value="resend" text="Resend" />
            <SelectItem value="sendgrid" text="SendGrid" />
            <SelectItem value="mailgun" text="Mailgun" />
            <SelectItem value="mailjet" text="Mailjet" />
            <SelectItem value="smtp" text="SMTP" />
          </Select>
          {formData.provider === 'smtp' ? (
            <>
              <TextInput
                id="edit-smtpHost"
                labelText="SMTP Host"
                placeholder="e.g., smtp.gmail.com"
                value={formData.smtpHost}
                onChange={(e) => setFormData({ ...formData, smtpHost: e.target.value })}
                disabled={!canManageSettings}
              />
              <TextInput
                id="edit-smtpPort"
                labelText="SMTP Port"
                type="number"
                placeholder="587"
                value={formData.smtpPort}
                onChange={(e) => setFormData({ ...formData, smtpPort: e.target.value ? parseInt(e.target.value) : '' })}
                disabled={!canManageSettings}
              />
              <TextInput
                id="edit-smtpUser"
                labelText="SMTP Username (optional)"
                placeholder="e.g., user@example.com"
                value={formData.smtpUser}
                onChange={(e) => setFormData({ ...formData, smtpUser: e.target.value })}
                disabled={!canManageSettings}
              />
              <TextInput
                id="edit-apiKey"
                labelText="SMTP Password (leave blank to keep existing)"
                type="password"
                placeholder="Enter new password to update"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                disabled={!canManageSettings}
              />
              <Toggle
                id="edit-smtpSecure"
                labelText="Use TLS/SSL"
                toggled={formData.smtpSecure}
                onToggle={(checked) => setFormData({ ...formData, smtpSecure: checked })}
                disabled={!canManageSettings}
              />
            </>
          ) : (
            <TextInput
              id="edit-apiKey"
              labelText="API Key (leave blank to keep existing)"
              type="password"
              placeholder="Enter new API key to update"
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              disabled={!canManageSettings}
            />
          )}
          <TextInput
            id="edit-fromName"
            labelText="From Name"
            value={formData.fromName}
            onChange={(e) => setFormData({ ...formData, fromName: e.target.value })}
            disabled={!canManageSettings}
          />
          <TextInput
            id="edit-fromEmail"
            labelText="From Email"
            type="email"
            value={formData.fromEmail}
            onChange={(e) => setFormData({ ...formData, fromEmail: e.target.value })}
            disabled={!canManageSettings}
          />
          <TextInput
            id="edit-replyTo"
            labelText="Reply-To Email (optional)"
            type="email"
            value={formData.replyTo}
            onChange={(e) => setFormData({ ...formData, replyTo: e.target.value })}
            disabled={!canManageSettings}
          />
          <Toggle
            id="edit-enabled"
            labelText="Enabled"
            toggled={formData.enabled}
            onToggle={(checked) => setFormData({ ...formData, enabled: checked })}
            disabled={!canManageSettings}
          />
        </div>
      </FormModal>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={deleteModal.isOpen}
        onClose={deleteModal.closeModal}
        onConfirm={() => deleteModal.data && deleteMutation.mutate(deleteModal.data.id)}
        title="Delete Email Configuration"
        description={`Are you sure you want to delete "${deleteModal.data?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        danger
        busy={deleteMutation.isPending}
        confirmDisabled={!canManageSettings}
        disabledReason={!canManageSettings ? disabledReason : null}
      />

      {/* Test Send Modal */}
      <FormModal
        open={testModal.isOpen}
        onClose={testModal.closeModal}
        onSubmit={() => testModal.data && testMutation.mutate({ id: testModal.data.id, toEmail: testEmail })}
        title="Send Test Email"
        submitText="Send Test"
        busy={testMutation.isPending}
        submitDisabled={!canManageSettings || !testEmail}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          {!canManageSettings && (
            <InlineNotification kind="warning" title="Email settings are read-only" subtitle={disabledReason} hideCloseButton lowContrast />
          )}
          {testResult && (
            <div style={{ color: testResult.success ? 'var(--cds-support-success)' : 'var(--cds-support-error)', fontSize: 14 }}>
              {testResult.message}
            </div>
          )}
          <p>Send a test email using the "{testModal.data?.name}" configuration.</p>
          <TextInput
            id="test-email"
            labelText="Send To"
            type="email"
            placeholder="your@email.com"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            disabled={!canManageSettings}
          />
        </div>
      </FormModal>
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
        title="Email Configurations"
        subtitle="Manage email provider settings for sending emails"
        gradient={PAGE_GRADIENTS.purple}
      />
      {content}
    </PageLayout>
  );
}
