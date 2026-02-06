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
} from '@carbon/react';
import { Email, Edit, View, Reset } from '@carbon/icons-react';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../shared/components/PageLayout';
import { apiClient } from '../../shared/api/client';
import { parseApiError } from '../../shared/api/apiErrorUtils';
import { useToast } from '../../shared/notifications/ToastProvider';

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
}

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

export default function EmailTemplates() {
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

  const platformNameQuery = useQuery({
    queryKey: ['email-platform-name'],
    queryFn: () => apiClient.get<{ emailPlatformName: string }>('/api/admin/email-platform-name'),
  });

  const updatePlatformNameMutation = useMutation({
    mutationFn: (value: string) =>
      apiClient.put('/api/admin/email-platform-name', { emailPlatformName: value }),
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
    queryFn: () => apiClient.get<EmailTemplate[]>('/api/admin/email-templates'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiClient.patch(`/api/admin/email-templates/${id}`, data),
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
    mutationFn: (id: string) => apiClient.post(`/api/admin/email-templates/${id}/reset`),
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

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 'var(--spacing-3)',
          flexWrap: 'wrap',
        }}
      >
        <TextInput
          id="email-platform-name"
          labelText="Email Platform Name"
          value={emailPlatformName}
          onChange={(e) => setEmailPlatformName(e.target.value)}
          style={{ minWidth: 320 }}
        />
        <Button
          kind="primary"
          size="md"
          onClick={() => {
            const v = emailPlatformName.trim();
            if (!v) {
              notify({ kind: 'error', title: 'Email platform name cannot be empty' });
              return;
            }
            updatePlatformNameMutation.mutate(v);
          }}
          disabled={platformNameQuery.isLoading || updatePlatformNameMutation.isPending}
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
                                    onClick={() => openEditModal(template)}
                                  />
                                  <Button
                                    kind="ghost"
                                    size="sm"
                                    hasIconOnly
                                    renderIcon={Reset}
                                    iconDescription="Reset to Default"
                                    onClick={() => {
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
          if (editingTemplate) {
            updateMutation.mutate({ id: editingTemplate.id, data: formData });
          }
        }}
        size="lg"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          <TextInput
            id="template-name"
            labelText="Template Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <TextInput
            id="template-subject"
            labelText="Email Subject"
            value={formData.subject}
            onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
            helperText="Use {{variableName}} for dynamic values"
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
          />
          <TextArea
            id="template-text"
            labelText="Plain Text Template (optional)"
            value={formData.textTemplate}
            onChange={(e) => setFormData({ ...formData, textTemplate: e.target.value })}
            rows={5}
          />
          <Toggle
            id="template-active"
            labelText="Active"
            toggled={formData.isActive}
            onToggle={(checked) => setFormData({ ...formData, isActive: checked })}
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
    </PageLayout>
  );
}
