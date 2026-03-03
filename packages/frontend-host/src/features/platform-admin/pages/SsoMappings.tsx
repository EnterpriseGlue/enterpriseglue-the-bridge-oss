/**
 * SSO Claims Mapping Admin Page
 * Manage how SSO claims (groups, roles, email domains) map to platform roles
 */

import React from 'react';
import {
  Button,
  DataTable,
  DataTableSkeleton,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
  TableToolbar,
  TableToolbarContent,
  Tag,
  OverflowMenu,
  OverflowMenuItem,
  InlineNotification,
  TextInput,
  Dropdown,
  NumberInput,
  Toggle,
  Modal,
} from '@carbon/react';
import { Add, UserMultiple } from '@carbon/icons-react';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../../shared/components/PageLayout';
import { apiClient } from '../../../shared/api/client';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import {
  useSsoClaimsMappings,
  useCreateSsoMapping,
  useUpdateSsoMapping,
  useDeleteSsoMapping,
  useTestSsoMapping,
  type SsoClaimsMapping,
} from '../hooks/useAuthzApi';

const CLAIM_TYPES = [
  { id: 'group', label: 'Group' },
  { id: 'role', label: 'Role' },
  { id: 'email_domain', label: 'Email Domain' },
  { id: 'custom', label: 'Custom Claim' },
];

const TARGET_ROLES = [
  { id: 'admin', label: 'Platform Admin' },
  { id: 'developer', label: 'Developer' },
  { id: 'user', label: 'User' },
];

const headers = [
  { key: 'claimType', header: 'Claim Type' },
  { key: 'claimKey', header: 'Claim Key' },
  { key: 'claimValue', header: 'Claim Value' },
  { key: 'targetRole', header: 'Target Role' },
  { key: 'priority', header: 'Priority' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

export default function SsoMappings() {
  const mappingsQ = useSsoClaimsMappings();
  const createM = useCreateSsoMapping();
  const updateM = useUpdateSsoMapping();
  const deleteM = useDeleteSsoMapping();
  const testM = useTestSsoMapping();

  const [modalOpen, setModalOpen] = React.useState(false);
  const [testModalOpen, setTestModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SsoClaimsMapping | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [form, setForm] = React.useState({
    claimType: 'group' as SsoClaimsMapping['claimType'],
    claimKey: 'groups',
    claimValue: '',
    targetRole: 'user' as SsoClaimsMapping['targetRole'],
    priority: 0,
    isActive: true,
  });

  const [testClaims, setTestClaims] = React.useState('{\n  "email": "user@example.com",\n  "groups": ["Developers"]\n}');
  const [testResult, setTestResult] = React.useState<{ resolvedRole: string; matchedMappings: any[] } | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm({
      claimType: 'group',
      claimKey: 'groups',
      claimValue: '',
      targetRole: 'user',
      priority: 0,
      isActive: true,
    });
    setModalOpen(true);
  };

  const openEdit = (mapping: SsoClaimsMapping) => {
    setEditing(mapping);
    setForm({
      claimType: mapping.claimType,
      claimKey: mapping.claimKey,
      claimValue: mapping.claimValue,
      targetRole: mapping.targetRole,
      priority: mapping.priority,
      isActive: mapping.isActive,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      if (editing) {
        await updateM.mutateAsync({ id: editing.id, ...form });
      } else {
        await createM.mutateAsync({ ...form, providerId: null });
      }
      setModalOpen(false);
      setError(null);
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to save mapping');
      setError(parsed.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteM.mutateAsync(id);
      setError(null);
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to delete mapping');
      setError(parsed.message);
    }
  };

  const handleTest = async () => {
    try {
      const claims = JSON.parse(testClaims);
      const result = await testM.mutateAsync({ claims });
      setTestResult(result);
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to test claims');
      setError(parsed.message);
    }
  };

  const mappings = mappingsQ.data || [];

  const getRoleTag = (role: string) => {
    switch (role) {
      case 'admin': return <Tag type="red">Admin</Tag>;
      case 'developer': return <Tag type="blue">Developer</Tag>;
      default: return <Tag type="gray">User</Tag>;
    }
  };

  const getClaimTypeLabel = (type: string) => {
    return CLAIM_TYPES.find(t => t.id === type)?.label || type;
  };

  return (
    <PageLayout>
      <PageHeader
        icon={UserMultiple}
        title="SSO Role Mappings"
        subtitle="Map SSO claims (groups, roles, email domains) to platform roles"
        gradient={PAGE_GRADIENTS.purple}
      />

      {error && (
        <InlineNotification
          kind="error"
          title={error}
          onCloseButtonClick={() => setError(null)}
          lowContrast
          style={{ marginBottom: 'var(--spacing-4)' }}
        />
      )}

      {mappingsQ.isLoading && (
        <DataTableSkeleton headers={headers} rowCount={5} />
      )}

      {mappingsQ.isError && (
        <InlineNotification
          kind="error"
          title="Failed to load SSO mappings"
          subtitle={(mappingsQ.error as any)?.message}
          lowContrast
        />
      )}

      {!mappingsQ.isLoading && !mappingsQ.isError && (
        <TableContainer>
          <DataTable
            rows={mappings.map(m => ({
              id: m.id,
              claimType: getClaimTypeLabel(m.claimType),
              claimKey: m.claimKey,
              claimValue: m.claimValue,
              targetRole: m.targetRole,
              priority: m.priority,
              status: m.isActive,
              actions: '',
            }))}
            headers={headers}
          >
            {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
              <>
                <TableToolbar>
                  <TableToolbarContent>
                    <Button
                      kind="ghost"
                      size="sm"
                      onClick={() => setTestModalOpen(true)}
                    >
                      Test Claims
                    </Button>
                    <Button
                      kind="primary"
                      renderIcon={Add}
                      onClick={openCreate}
                    >
                      Add Mapping
                    </Button>
                  </TableToolbarContent>
                </TableToolbar>
                <Table {...getTableProps()} size="md">
                  <TableHead>
                    <TableRow>
                      {headers.map(header => (
                        <TableHeader {...getHeaderProps({ header })}>
                          {header.header}
                        </TableHeader>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={headers.length} style={{ textAlign: 'center', padding: 'var(--spacing-5)' }}>
                          No SSO mappings configured. Add your first mapping to enable automatic role assignment.
                        </TableCell>
                      </TableRow>
                    )}
                    {rows.map(row => {
                      const mapping = mappings.find(m => m.id === row.id);
                      return (
                        <TableRow {...getRowProps({ row })}>
                          {row.cells.map(cell => {
                            if (cell.info.header === 'targetRole') {
                              return (
                                <TableCell key={cell.id}>
                                  {getRoleTag(cell.value)}
                                </TableCell>
                              );
                            }
                            if (cell.info.header === 'status') {
                              return (
                                <TableCell key={cell.id}>
                                  <Tag type={cell.value ? 'green' : 'gray'}>
                                    {cell.value ? 'Active' : 'Inactive'}
                                  </Tag>
                                </TableCell>
                              );
                            }
                            if (cell.info.header === 'claimValue') {
                              return (
                                <TableCell key={cell.id}>
                                  <code style={{ 
                                    background: 'var(--cds-layer-02)', 
                                    padding: '2px 6px', 
                                    borderRadius: '4px',
                                    fontSize: '13px',
                                  }}>
                                    {cell.value}
                                  </code>
                                </TableCell>
                              );
                            }
                            if (cell.info.header === 'actions') {
                              return (
                                <TableCell key={cell.id}>
                                  <OverflowMenu size="sm" flipped>
                                    <OverflowMenuItem
                                      itemText="Edit"
                                      onClick={() => mapping && openEdit(mapping)}
                                    />
                                    <OverflowMenuItem
                                      itemText={mapping?.isActive ? 'Disable' : 'Enable'}
                                      onClick={() => mapping && updateM.mutate({ 
                                        id: mapping.id, 
                                        isActive: !mapping.isActive 
                                      })}
                                    />
                                    <OverflowMenuItem
                                      itemText="Delete"
                                      isDelete
                                      hasDivider
                                      onClick={() => handleDelete(row.id)}
                                    />
                                  </OverflowMenu>
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
              </>
            )}
          </DataTable>
        </TableContainer>
      )}

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onRequestClose={() => setModalOpen(false)}
        onRequestSubmit={handleSubmit}
        modalHeading={editing ? 'Edit SSO Mapping' : 'Add SSO Mapping'}
        primaryButtonText={editing ? 'Save' : 'Create'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={!form.claimValue || createM.isPending || updateM.isPending}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
          <Dropdown
            id="claim-type"
            titleText="Claim Type"
            label="Select type"
            items={CLAIM_TYPES}
            itemToString={(item: any) => item?.label || ''}
            selectedItem={CLAIM_TYPES.find(t => t.id === form.claimType)}
            onChange={({ selectedItem }: any) => {
              const type = selectedItem?.id || 'group';
              setForm(f => ({ 
                ...f, 
                claimType: type,
                claimKey: type === 'group' ? 'groups' : type === 'role' ? 'roles' : type === 'email_domain' ? 'email' : f.claimKey,
              }));
            }}
          />

          <TextInput
            id="claim-key"
            labelText="Claim Key"
            helperText="The claim attribute name in the SSO token (e.g., groups, roles, email)"
            value={form.claimKey}
            onChange={(e) => setForm(f => ({ ...f, claimKey: e.target.value }))}
          />

          <TextInput
            id="claim-value"
            labelText="Claim Value"
            helperText="The value to match. Use * for wildcard. For email domains, use *@domain.com"
            placeholder={form.claimType === 'group' ? 'e.g., Platform Admins' : form.claimType === 'email_domain' ? '*@acme.com' : ''}
            value={form.claimValue}
            onChange={(e) => setForm(f => ({ ...f, claimValue: e.target.value }))}
          />

          <Dropdown
            id="target-role"
            titleText="Target Role"
            label="Select role"
            items={TARGET_ROLES}
            itemToString={(item: any) => item?.label || ''}
            selectedItem={TARGET_ROLES.find(r => r.id === form.targetRole)}
            onChange={({ selectedItem }: any) => setForm(f => ({ ...f, targetRole: selectedItem?.id || 'user' }))}
          />

          <NumberInput
            id="priority"
            label="Priority"
            helperText="Higher priority mappings are evaluated first. Useful when multiple rules could match."
            value={form.priority}
            min={0}
            max={1000}
            onChange={(_e, { value }) => setForm(f => ({ ...f, priority: Number(value) || 0 }))}
          />

          <Toggle
            id="is-active"
            labelText="Active"
            labelA="Inactive"
            labelB="Active"
            toggled={form.isActive}
            onToggle={(checked) => setForm(f => ({ ...f, isActive: checked }))}
          />
        </div>
      </Modal>

      {/* Test Claims Modal */}
      <Modal
        open={testModalOpen}
        onRequestClose={() => {
          setTestModalOpen(false);
          setTestResult(null);
        }}
        onRequestSubmit={handleTest}
        modalHeading="Test SSO Claims"
        primaryButtonText="Test"
        secondaryButtonText="Close"
        primaryButtonDisabled={testM.isPending}
        size="lg"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          <p style={{ fontSize: '14px', color: 'var(--cds-text-secondary)' }}>
            Enter sample SSO claims to test which role would be assigned:
          </p>
          
          <textarea
            style={{
              width: '100%',
              minHeight: '150px',
              padding: 'var(--spacing-3)',
              fontFamily: 'monospace',
              fontSize: '13px',
              border: '1px solid var(--cds-border-subtle)',
              borderRadius: '4px',
              background: 'var(--cds-layer-01)',
              color: 'var(--cds-text-primary)',
            }}
            value={testClaims}
            onChange={(e) => setTestClaims(e.target.value)}
            placeholder='{"email": "user@example.com", "groups": ["Developers"]}'
          />

          {testResult && (
            <div style={{ 
              padding: 'var(--spacing-4)', 
              background: 'var(--cds-layer-02)', 
              borderRadius: '8px',
              marginTop: 'var(--spacing-3)',
            }}>
              <h4 style={{ margin: '0 0 var(--spacing-3) 0', fontSize: '14px', fontWeight: 600 }}>
                Result
              </h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-3)' }}>
                <span>Resolved Role:</span>
                {getRoleTag(testResult.resolvedRole)}
              </div>
              {testResult.matchedMappings.length > 0 && (
                <>
                  <h5 style={{ margin: 'var(--spacing-3) 0 var(--spacing-2) 0', fontSize: '13px', fontWeight: 500 }}>
                    Matched Mappings:
                  </h5>
                  <ul style={{ margin: 0, paddingLeft: 'var(--spacing-4)', fontSize: '13px' }}>
                    {testResult.matchedMappings.map((m, i) => (
                      <li key={i}>
                        {m.name} → {getRoleTag(m.targetRole)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </Modal>
    </PageLayout>
  );
}
