import React from 'react';
import { Accordion, AccordionItem, Button, ComboBox, DataTable, DataTableSkeleton, Dropdown, InlineNotification, Modal, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableToolbar, TableToolbarContent, TableToolbarSearch, Tag, TextInput } from '@carbon/react';
import { Add } from '@carbon/icons-react';
import type { DeploymentEligibilityResult, ProjectEngineTarget, ProjectEngineTargetMode } from '../../hooks/useAuthzApi';
import type { UiAuthzDecision } from '@enterpriseglue/shared/authz/permission-actions.js';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';
import { formatDeploymentEligibility, formatProjectEngineTargetDiagnostics, formatProjectEngineTargetExternalRefs, formatProjectEngineTargetModes, isSourceOwnedProjectTarget, projectEngineTargetHeaders, projectEngineTargetLabel, projectEngineTargetModes } from './projectEngineTargetPresentation';
import { GuardedOverflowMenu, GuardedOverflowMenuItem } from '../../../../shared/auth/guards';
import { UserPrincipalPicker } from '../../components/UserPrincipalPicker';
export function ProjectEngineTargetsPanel({
  targets,
  loading,
  pending,
  syncSummary,
  eligibilityResult,
  onCreate,
  onEdit,
  onArchive,
  onSyncLegacy,
  onEvaluate,
  canManage,
  canEvaluate,
  manageUnavailableReason,
  evaluateUnavailableReason,
  externalProjectTargetApiUpsertDecision,
  externalProjectTargetApiDecommissionDecision,
}: {
  targets: ProjectEngineTarget[];
  loading: boolean;
  pending: boolean;
  syncSummary: string | null;
  eligibilityResult: DeploymentEligibilityResult | null;
  onCreate: () => void;
  onEdit: (target: ProjectEngineTarget) => void;
  onArchive: (id: string) => void;
  onSyncLegacy: (projectId: string) => void;
  onEvaluate: (form: { userId: string; projectId: string; engineId: string; mode: ProjectEngineTargetMode }) => void;
  canManage: boolean;
  canEvaluate: boolean;
  manageUnavailableReason?: string;
  evaluateUnavailableReason?: string;
  externalProjectTargetApiUpsertDecision: UiAuthzDecision;
  externalProjectTargetApiDecommissionDecision: UiAuthzDecision;
}) {
  const [projectFilter, setProjectFilter] = React.useState('');
  const [engineFilter, setEngineFilter] = React.useState('');
  const [syncProjectId, setSyncProjectId] = React.useState('');
  const [archiveTarget, setArchiveTarget] = React.useState<ProjectEngineTarget | null>(null);
  const [evaluateForm, setEvaluateForm] = React.useState({
    userId: '',
    projectId: '',
    engineId: '',
    mode: 'manual' as ProjectEngineTargetMode,
  });
  const selectedEvaluateMode = projectEngineTargetModes.find((item) => item.id === evaluateForm.mode) || projectEngineTargetModes[0];
  const projects = React.useMemo(() => Array.from(new Map(targets.map((target) => [target.projectId, {
    id: target.projectId,
    name: target.projectName || target.projectId,
  }])).values()), [targets]);
  const engines = React.useMemo(() => Array.from(new Map(targets.map((target) => [target.engineId, {
    id: target.engineId,
    name: target.engineName || target.engineId,
  }])).values()), [targets]);
  const selectedSyncProject = projects.find((project) => project.id === syncProjectId) || null;
  const selectedEvaluateProject = projects.find((project) => project.id === evaluateForm.projectId) || null;
  const selectedEvaluateEngine = engines.find((engine) => engine.id === evaluateForm.engineId) || null;
  const filteredTargets = React.useMemo(() => targets.filter((target) => {
    const matchesProject = !projectFilter.trim() || target.projectId.toLowerCase().includes(projectFilter.trim().toLowerCase()) || (target.projectName || '').toLowerCase().includes(projectFilter.trim().toLowerCase());
    const matchesEngine = !engineFilter.trim() || target.engineId.toLowerCase().includes(engineFilter.trim().toLowerCase()) || (target.engineName || '').toLowerCase().includes(engineFilter.trim().toLowerCase());
    return matchesProject && matchesEngine;
  }), [engineFilter, projectFilter, targets]);

  if (loading) return <DataTableSkeleton headers={projectEngineTargetHeaders} rowCount={5} />;

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      <Accordion>
        <AccordionItem title="Advanced integration status">
          <div aria-label="Project target API diagnostics" style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
            <p style={{ margin: 0, color: 'var(--cds-text-secondary)' }}>External registration capabilities used by automation and headless deployments.</p>
            <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              <Tag type={externalProjectTargetApiUpsertDecision.allowed ? 'green' : 'red'} title={externalProjectTargetApiUpsertDecision.reason}>
                Register targets: {externalProjectTargetApiUpsertDecision.allowed ? 'available' : 'unavailable'}
              </Tag>
              <Tag type={externalProjectTargetApiDecommissionDecision.allowed ? 'green' : 'red'} title={externalProjectTargetApiDecommissionDecision.reason}>
                Decommission targets: {externalProjectTargetApiDecommissionDecision.allowed ? 'available' : 'unavailable'}
              </Tag>
            </div>
          </div>
        </AccordionItem>
      </Accordion>
      {syncSummary && (
        <InlineNotification kind="info" title="Existing project targets imported" subtitle={syncSummary} lowContrast />
      )}
      {eligibilityResult && (
        <InlineNotification
          kind={eligibilityResult.allowed ? 'success' : 'warning'}
          title={eligibilityResult.allowed ? 'Deployment eligibility allowed' : 'Deployment eligibility denied'}
          subtitle={formatDeploymentEligibility(eligibilityResult)}
          lowContrast
        />
      )}
      <TableContainer>
        <DataTable
          rows={filteredTargets.map((target) => ({
            id: target.id,
            project: target.projectName || target.projectId,
            engine: target.engineName || target.engineId,
            environment: target.environment?.name || '-',
            status: target.status,
            source: target.source,
            modes: formatProjectEngineTargetModes(target),
            approval: projectEngineTargetLabel(target.approvalStatus),
            external: formatProjectEngineTargetExternalRefs(target),
            diagnostics: formatProjectEngineTargetDiagnostics(target),
            actions: '',
          }))}
          headers={projectEngineTargetHeaders}
        >
          {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
            <>
              <TableToolbar>
                <TableToolbarContent>
                  <TableToolbarSearch persistent placeholder="Filter projects" value={projectFilter} onChange={(event: any) => setProjectFilter(event.target.value)} />
                  <TextInput
                    id="target-engine-filter"
                    labelText=""
                    aria-label="Filter engines"
                    placeholder="Filter engines"
                    className="eg-table-toolbar-text-filter"
                    size="lg"
                    value={engineFilter}
                    onChange={(event) => setEngineFilter(event.target.value)}
                  />
                  <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={manageUnavailableReason}>
                    Create target
                  </Button>
                </TableToolbarContent>
              </TableToolbar>
              <Table {...getTableProps()} size="md">
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <DataTableHeaderCell key={dataTableHeaderKey(header)} header={header} getHeaderProps={getHeaderProps} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={headers.length}>No project-engine targets match the current filters.</TableCell>
                    </TableRow>
                  ) : rows.map((row) => {
                    const target = filteredTargets.find((item) => item.id === row.id);
                    const sourceOwned = target ? isSourceOwnedProjectTarget(target) : false;
                    const rowManageUnavailableReason = !canManage
                      ? manageUnavailableReason
                      : sourceOwned
                        ? 'Source-owned targets are managed by their external source'
                        : undefined;
                    return (
                      <DataTableDataRow key={row.id} row={row} getRowProps={getRowProps}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'status') {
                            const status = String(cell.value);
                            const type = status === 'active' ? 'green' : status === 'disabled' ? 'gray' : 'red';
                            return <TableCell key={cell.id}><Tag type={type}>{projectEngineTargetLabel(status)}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'source') {
                            return <TableCell key={cell.id}><div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}><Tag type={target?.source === 'config' && target.ownershipMode === 'config_warn' ? 'warm-gray' : target?.source === 'config' ? 'purple' : sourceOwned ? 'cyan' : 'gray'}>{target?.source === 'config' && target.ownershipMode === 'config_warn' ? 'Configuration-linked' : target?.source === 'config' ? 'Managed by configuration' : cell.value}</Tag>{target?.driftStatus === 'drifted' && <Tag type="red">Different from configuration</Tag>}</div></TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {target && (
                                  <GuardedOverflowMenu size="sm" flipped iconDescription={`Actions for ${target.projectName || target.projectId}`}>
                                    <GuardedOverflowMenuItem itemText="Edit" disabled={pending || Boolean(rowManageUnavailableReason)} unavailableReason={rowManageUnavailableReason} onClick={() => onEdit(target)} />
                                    {target.status !== 'archived' && (
                                      <GuardedOverflowMenuItem itemText="Archive" isDelete disabled={pending || Boolean(rowManageUnavailableReason)} unavailableReason={rowManageUnavailableReason} onClick={() => setArchiveTarget(target)} />
                                    )}
                                  </GuardedOverflowMenu>
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </DataTableDataRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </DataTable>
      </TableContainer>

      <section aria-labelledby="legacy-target-migration-heading" style={{ borderTop: '1px solid var(--cds-border-subtle)', paddingTop: 'var(--spacing-5)' }}>
        <h3 id="legacy-target-migration-heading" style={{ margin: 0, fontSize: '1rem' }}>Import existing project targets</h3>
        <p style={{ margin: 'var(--spacing-2) 0 var(--spacing-4)', color: 'var(--cds-text-secondary)' }}>
          Create project targets from this project’s existing engine connections.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)', alignItems: 'end' }}>
        <ComboBox
          id="target-sync-project"
          titleText="Project"
          placeholder="Find a project"
          items={projects}
          itemToString={(item) => item?.name || ''}
          selectedItem={selectedSyncProject}
          onChange={({ selectedItem }) => setSyncProjectId(selectedItem?.id || '')}
        />
        <Button disabled={!syncProjectId.trim() || pending || !canManage} title={manageUnavailableReason} onClick={() => onSyncLegacy(syncProjectId.trim())}>
          Import targets
        </Button>
      </div>
      </section>

      <section aria-labelledby="deployment-eligibility-heading" style={{ borderTop: '1px solid var(--cds-border-subtle)', paddingTop: 'var(--spacing-5)' }}>
        <h3 id="deployment-eligibility-heading" style={{ margin: 0, fontSize: '1rem' }}>Check deployment access</h3>
        <p style={{ margin: 'var(--spacing-2) 0 var(--spacing-4)', color: 'var(--cds-text-secondary)' }}>
          Simulate whether one user may deploy or import through a selected project-engine target. No access is changed.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)', alignItems: 'end' }}>
        <UserPrincipalPicker id="target-evaluate-user" labelText="User" value={evaluateForm.userId} onChange={(userId) => setEvaluateForm((current) => ({ ...current, userId }))} />
        <ComboBox id="target-evaluate-project" titleText="Project" placeholder="Find a project" items={projects} itemToString={(item) => item?.name || ''} selectedItem={selectedEvaluateProject} onChange={({ selectedItem }) => setEvaluateForm((current) => ({ ...current, projectId: selectedItem?.id || '' }))} />
        <ComboBox id="target-evaluate-engine" titleText="Engine" placeholder="Find an engine" items={engines} itemToString={(item) => item?.name || ''} selectedItem={selectedEvaluateEngine} onChange={({ selectedItem }) => setEvaluateForm((current) => ({ ...current, engineId: selectedItem?.id || '' }))} />
        <Dropdown
          id="target-evaluate-mode"
          titleText="Mode"
          label="Mode"
          items={projectEngineTargetModes}
          itemToString={(item) => item?.label || ''}
          selectedItem={selectedEvaluateMode}
          onChange={({ selectedItem }) => setEvaluateForm((current) => ({ ...current, mode: (selectedItem?.id || 'manual') as ProjectEngineTargetMode }))}
        />
        <Button
          disabled={!canEvaluate || pending || !evaluateForm.userId.trim() || !evaluateForm.projectId.trim() || !evaluateForm.engineId.trim()}
          title={evaluateUnavailableReason}
          onClick={() => onEvaluate({
            userId: evaluateForm.userId.trim(),
            projectId: evaluateForm.projectId.trim(),
            engineId: evaluateForm.engineId.trim(),
            mode: evaluateForm.mode,
          })}
        >
          Check deployment access
        </Button>
      </div>
      </section>
      <Modal
        open={Boolean(archiveTarget)}
        danger
        modalHeading="Archive project target"
        primaryButtonText="Archive"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={pending}
        onRequestClose={() => setArchiveTarget(null)}
        onRequestSubmit={() => {
          if (!archiveTarget) return;
          onArchive(archiveTarget.id);
          setArchiveTarget(null);
        }}
      >
        <p>Archive the target from <strong>{archiveTarget?.projectName || archiveTarget?.projectId}</strong> to <strong>{archiveTarget?.engineName || archiveTarget?.engineId}</strong>? New deployments through this target will stop.</p>
      </Modal>
    </div>
  );
}
