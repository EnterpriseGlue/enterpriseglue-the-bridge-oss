/**
 * Authorization Policies Admin Page
 * Manage ABAC policies with conditions for fine-grained access control
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
  TextArea,
  Dropdown,
  NumberInput,
  Toggle,
  Modal,
  Accordion,
  AccordionItem,
} from '@carbon/react';
import { Add, Policy } from '@carbon/icons-react';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../../shared/components/PageLayout';
import { parseApiError } from '../../../shared/api/apiErrorUtils';
import {
  useAuthzPolicies,
  useCreatePolicy,
  useUpdatePolicy,
  useDeletePolicy,
  type AuthzPolicy,
  type PolicyCondition,
} from '../hooks/useAuthzApi';

const EFFECTS = [
  { id: 'allow', label: 'Allow' },
  { id: 'deny', label: 'Deny' },
];

const RESOURCE_TYPES = [
  { id: '', label: 'All Resources' },
  { id: 'project', label: 'Project' },
  { id: 'engine', label: 'Engine' },
  { id: 'platform', label: 'Platform' },
];

const headers = [
  { key: 'name', header: 'Name' },
  { key: 'effect', header: 'Effect' },
  { key: 'resourceType', header: 'Resource Type' },
  { key: 'action', header: 'Action' },
  { key: 'priority', header: 'Priority' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: '' },
];

const DEFAULT_CONDITIONS: PolicyCondition = {};

export default function AuthzPolicies() {
  const policiesQ = useAuthzPolicies();
  const createM = useCreatePolicy();
  const updateM = useUpdatePolicy();
  const deleteM = useDeletePolicy();

  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AuthzPolicy | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [form, setForm] = React.useState({
    name: '',
    description: '',
    effect: 'deny' as 'allow' | 'deny',
    priority: 100,
    resourceType: '',
    action: '',
    conditions: DEFAULT_CONDITIONS,
  });

  const [conditionsJson, setConditionsJson] = React.useState('{}');

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      description: '',
      effect: 'deny',
      priority: 100,
      resourceType: '',
      action: '',
      conditions: DEFAULT_CONDITIONS,
    });
    setConditionsJson('{}');
    setModalOpen(true);
  };

  const openEdit = (policy: AuthzPolicy) => {
    setEditing(policy);
    setForm({
      name: policy.name,
      description: policy.description || '',
      effect: policy.effect,
      priority: policy.priority,
      resourceType: policy.resourceType || '',
      action: policy.action || '',
      conditions: policy.conditions || DEFAULT_CONDITIONS,
    });
    setConditionsJson(JSON.stringify(policy.conditions || {}, null, 2));
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      let conditions: PolicyCondition;
      try {
        conditions = JSON.parse(conditionsJson);
      } catch {
        setError('Invalid JSON in conditions');
        return;
      }

      const payload = {
        ...form,
        resourceType: form.resourceType || undefined,
        action: form.action || undefined,
        conditions,
      };

      if (editing) {
        await updateM.mutateAsync({ id: editing.id, ...payload });
      } else {
        await createM.mutateAsync(payload);
      }
      setModalOpen(false);
      setError(null);
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to save policy');
      setError(parsed.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteM.mutateAsync(id);
      setError(null);
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to delete policy');
      setError(parsed.message);
    }
  };

  const policies = policiesQ.data || [];

  const getEffectTag = (effect: string) => {
    return effect === 'deny' 
      ? <Tag type="red">Deny</Tag>
      : <Tag type="green">Allow</Tag>;
  };

  return (
    <PageLayout>
      <PageHeader
        icon={Policy}
        title="Authorization Policies"
        subtitle="Define ABAC policies with conditions for fine-grained access control"
        gradient={PAGE_GRADIENTS.teal}
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

      {policiesQ.isLoading && (
        <DataTableSkeleton headers={headers} rowCount={5} />
      )}

      {policiesQ.isError && (
        <InlineNotification
          kind="error"
          title="Failed to load policies"
          subtitle={parseApiError(policiesQ.error, 'Failed to load policies').message}
          lowContrast
        />
      )}

      {!policiesQ.isLoading && !policiesQ.isError && (
        <TableContainer>
          <DataTable
            rows={policies.map(p => ({
              id: p.id,
              name: p.name,
              effect: p.effect,
              resourceType: p.resourceType || 'All',
              action: p.action || 'All actions',
              priority: p.priority,
              status: p.isActive,
              actions: '',
            }))}
            headers={headers}
          >
            {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
              <>
                <TableToolbar>
                  <TableToolbarContent>
                    <Button
                      kind="primary"
                      renderIcon={Add}
                      onClick={openCreate}
                    >
                      Add Policy
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
                          No authorization policies configured. Policies extend role-based permissions with conditions.
                        </TableCell>
                      </TableRow>
                    )}
                    {rows.map(row => {
                      const policy = policies.find(p => p.id === row.id);
                      return (
                        <TableRow {...getRowProps({ row })}>
                          {row.cells.map(cell => {
                            if (cell.info.header === 'effect') {
                              return (
                                <TableCell key={cell.id}>
                                  {getEffectTag(cell.value)}
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
                            if (cell.info.header === 'action') {
                              return (
                                <TableCell key={cell.id}>
                                  <code style={{ 
                                    background: 'var(--cds-layer-02)', 
                                    padding: '2px 6px', 
                                    borderRadius: '4px',
                                    fontSize: '12px',
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
                                      onClick={() => policy && openEdit(policy)}
                                    />
                                    <OverflowMenuItem
                                      itemText={policy?.isActive ? 'Disable' : 'Enable'}
                                      onClick={() => policy && updateM.mutate({ 
                                        id: policy.id, 
                                        isActive: !policy.isActive 
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
        modalHeading={editing ? 'Edit Policy' : 'Add Policy'}
        primaryButtonText={editing ? 'Save' : 'Create'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={!form.name || createM.isPending || updateM.isPending}
        size="lg"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
          <TextInput
            id="policy-name"
            labelText="Name"
            placeholder="e.g., Block production deploys outside hours"
            value={form.name}
            onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
          />

          <TextArea
            id="policy-description"
            labelText="Description"
            placeholder="Describe what this policy does..."
            value={form.description}
            onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
            rows={2}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-4)' }}>
            <Dropdown
              id="policy-effect"
              titleText="Effect"
              label="Select effect"
              items={EFFECTS}
              itemToString={(item: any) => item?.label || ''}
              selectedItem={EFFECTS.find(e => e.id === form.effect)}
              onChange={({ selectedItem }: any) => setForm(f => ({ ...f, effect: selectedItem?.id || 'deny' }))}
            />

            <NumberInput
              id="policy-priority"
              label="Priority"
              helperText="Higher priority policies are evaluated first"
              value={form.priority}
              min={0}
              max={1000}
              onChange={(_e, { value }) => setForm(f => ({ ...f, priority: Number(value) || 0 }))}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-4)' }}>
            <Dropdown
              id="policy-resource-type"
              titleText="Resource Type"
              label="Select type"
              items={RESOURCE_TYPES}
              itemToString={(item: any) => item?.label || ''}
              selectedItem={RESOURCE_TYPES.find(r => r.id === form.resourceType)}
              onChange={({ selectedItem }: any) => setForm(f => ({ ...f, resourceType: selectedItem?.id || '' }))}
            />

            <TextInput
              id="policy-action"
              labelText="Action (Permission)"
              placeholder="e.g., engine:deploy or leave empty for all"
              helperText="The permission string to match"
              value={form.action}
              onChange={(e) => setForm(f => ({ ...f, action: e.target.value }))}
            />
          </div>

          <Accordion>
            <AccordionItem title="Conditions (Advanced)">
              <p style={{ fontSize: '13px', color: 'var(--cds-text-secondary)', marginBottom: 'var(--spacing-3)' }}>
                Define JSON conditions for when this policy applies. Leave empty for always-active policies.
              </p>
              <div style={{ fontSize: '12px', color: 'var(--cds-text-helper)', marginBottom: 'var(--spacing-3)' }}>
                <strong>Example conditions:</strong>
                <pre style={{ 
                  background: 'var(--cds-layer-02)', 
                  padding: 'var(--spacing-3)', 
                  borderRadius: '4px',
                  overflow: 'auto',
                  fontSize: '11px',
                }}>
{`{
  "timeWindow": {
    "start": "09:00",
    "end": "17:00",
    "timezone": "UTC",
    "daysOfWeek": [1, 2, 3, 4, 5]
  },
  "resourceAttribute": {
    "key": "isProduction",
    "operator": "eq",
    "value": true
  }
}`}
                </pre>
              </div>
              <TextArea
                id="policy-conditions"
                labelText="Conditions JSON"
                value={conditionsJson}
                onChange={(e) => setConditionsJson(e.target.value)}
                rows={8}
                style={{ fontFamily: 'monospace', fontSize: '12px' }}
              />
            </AccordionItem>
          </Accordion>
        </div>
      </Modal>
    </PageLayout>
  );
}
