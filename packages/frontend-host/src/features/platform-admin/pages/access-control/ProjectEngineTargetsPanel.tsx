import React from 'react';
import { Button, DataTable, DataTableSkeleton, Dropdown, InlineNotification, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableToolbar, TableToolbarContent, TableToolbarSearch, Tag, TextInput } from '@carbon/react';
import { Add, TrashCan } from '@carbon/icons-react';
import type { DeploymentEligibilityResult, ProjectEngineTarget, ProjectEngineTargetMode, ProjectEngineTargetSource } from '../../hooks/useAuthzApi';
import type { UiAuthzDecision } from '@enterpriseglue/shared/authz/permission-actions.js';
import { DataTableDataRow, DataTableHeaderCell, dataTableHeaderKey } from './dataTablePrimitives';
const projectEngineTargetHeaders=[{key:'project',header:'Project'},{key:'engine',header:'Engine'},{key:'environment',header:'Environment'},{key:'status',header:'Status'},{key:'source',header:'Source'},{key:'modes',header:'Modes'},{key:'approval',header:'Approval'},{key:'external',header:'External refs'},{key:'diagnostics',header:'Diagnostics'},{key:'actions',header:''}];
const PROJECT_ENGINE_TARGET_MODES:Array<{id:ProjectEngineTargetMode;label:string}>=[{id:'manual',label:'Manual'},{id:'ci',label:'CI'},{id:'api',label:'API'},{id:'import',label:'Import'}];
const sourceOwned=new Set<ProjectEngineTargetSource>(['ci','api','external','system','automation','config']);
const label=(value:string)=>value.split('_').map(x=>x[0]?.toUpperCase()+x.slice(1)).join(' ');
const isSourceOwnedProjectTarget=(target:ProjectEngineTarget)=>sourceOwned.has(target.source)&&!(target.source==='config'&&target.ownershipMode==='config_warn');
const formatProjectEngineTargetModes=(t:ProjectEngineTarget)=>[t.allowManualDeploy?'Manual':'',t.allowCiDeploy?'CI':'',t.allowApiDeploy?'API':'',t.allowImport?'Import':''].filter(Boolean).join(', ')||'-';
const formatProjectEngineTargetExternalRefs=(t:ProjectEngineTarget)=>[t.externalSystemId?'system='+t.externalSystemId:'',t.externalProjectId?'project='+t.externalProjectId:'',t.externalEngineId?'engine='+t.externalEngineId:'',t.externalTargetId?'target='+t.externalTargetId:''].filter(Boolean).join(', ')||'-';
const formatProjectEngineTargetDiagnostics=(t:ProjectEngineTarget)=>[t.policyTags.length?'Policies: '+t.policyTags.join(', '):'',t.diagnostics?Object.entries(t.diagnostics).map(([k,v])=>k+': '+(typeof v==='object'?JSON.stringify(v):String(v))).join(', '):''].filter(Boolean).join(' | ')||'-';
const formatDeploymentEligibility=(r:DeploymentEligibilityResult)=>r.allowed?'Allowed':r.reasons.length?r.reasons.join('; '):'Denied';
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
  const [evaluateForm, setEvaluateForm] = React.useState({
    userId: '',
    projectId: '',
    engineId: '',
    mode: 'manual' as ProjectEngineTargetMode,
  });
  const selectedEvaluateMode = PROJECT_ENGINE_TARGET_MODES.find((item) => item.id === evaluateForm.mode) || PROJECT_ENGINE_TARGET_MODES[0];
  const filteredTargets = React.useMemo(() => targets.filter((target) => {
    const matchesProject = !projectFilter.trim() || target.projectId.toLowerCase().includes(projectFilter.trim().toLowerCase()) || (target.projectName || '').toLowerCase().includes(projectFilter.trim().toLowerCase());
    const matchesEngine = !engineFilter.trim() || target.engineId.toLowerCase().includes(engineFilter.trim().toLowerCase()) || (target.engineName || '').toLowerCase().includes(engineFilter.trim().toLowerCase());
    return matchesProject && matchesEngine;
  }), [engineFilter, projectFilter, targets]);

  if (loading) return <DataTableSkeleton headers={projectEngineTargetHeaders} rowCount={5} />;

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      <div aria-label="Project target API diagnostics" style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
        <h3 style={{ margin: 0 }}>Project target API diagnostics</h3>
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <Tag
            type={externalProjectTargetApiUpsertDecision.allowed ? 'green' : 'red'}
            title={externalProjectTargetApiUpsertDecision.reason}
          >
            External API target registration {externalProjectTargetApiUpsertDecision.allowed ? 'allowed' : 'blocked'}
          </Tag>
          <Tag
            type={externalProjectTargetApiDecommissionDecision.allowed ? 'green' : 'red'}
            title={externalProjectTargetApiDecommissionDecision.reason}
          >
            External API target decommission {externalProjectTargetApiDecommissionDecision.allowed ? 'allowed' : 'blocked'}
          </Tag>
        </div>
      </div>
      {syncSummary && (
        <InlineNotification kind="info" title="Legacy project targets synced" subtitle={syncSummary} lowContrast />
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
            approval: label(target.approvalStatus),
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
                  <TextInput id="target-engine-filter" labelText="Filter engines" value={engineFilter} onChange={(event) => setEngineFilter(event.target.value)} />
                  <Button kind="primary" renderIcon={Add} onClick={onCreate} disabled={!canManage} title={manageUnavailableReason}>
                    Create Target
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
                            return <TableCell key={cell.id}><Tag type={type}>{label(status)}</Tag></TableCell>;
                          }
                          if (cell.info.header === 'source') {
                            return <TableCell key={cell.id}><div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}><Tag type={target?.source === 'config' && target.ownershipMode === 'config_warn' ? 'warm-gray' : target?.source === 'config' ? 'purple' : sourceOwned ? 'cyan' : 'gray'}>{target?.source === 'config' && target.ownershipMode === 'config_warn' ? 'Config warning' : target?.source === 'config' ? 'Managed by config' : cell.value}</Tag>{target?.driftStatus === 'drifted' && <Tag type="red">Drifted</Tag>}</div></TableCell>;
                          }
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {target && (
                                  <>
                                    <Button kind="ghost" size="sm" disabled={pending || Boolean(rowManageUnavailableReason)} title={rowManageUnavailableReason} onClick={() => onEdit(target)}>Edit</Button>
                                    {target.status !== 'archived' && (
                                      <Button kind="ghost" size="sm" disabled={pending || Boolean(rowManageUnavailableReason)} title={rowManageUnavailableReason} renderIcon={TrashCan} onClick={() => onArchive(target.id)}>Archive</Button>
                                    )}
                                  </>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)', alignItems: 'end' }}>
        <TextInput
          id="target-sync-project-id"
          labelText="Project ID to sync"
          value={syncProjectId}
          onChange={(event) => setSyncProjectId(event.target.value)}
        />
        <Button disabled={!syncProjectId.trim() || pending || !canManage} title={manageUnavailableReason} onClick={() => onSyncLegacy(syncProjectId.trim())}>
          Sync Legacy Targets
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-4)', alignItems: 'end' }}>
        <TextInput id="target-evaluate-user-id" labelText="User ID" value={evaluateForm.userId} onChange={(event) => setEvaluateForm((current) => ({ ...current, userId: event.target.value }))} />
        <TextInput id="target-evaluate-project-id" labelText="Project ID" value={evaluateForm.projectId} onChange={(event) => setEvaluateForm((current) => ({ ...current, projectId: event.target.value }))} />
        <TextInput id="target-evaluate-engine-id" labelText="Engine ID" value={evaluateForm.engineId} onChange={(event) => setEvaluateForm((current) => ({ ...current, engineId: event.target.value }))} />
        <Dropdown
          id="target-evaluate-mode"
          titleText="Mode"
          label="Mode"
          items={PROJECT_ENGINE_TARGET_MODES}
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
          Evaluate Eligibility
        </Button>
      </div>
    </div>
  );
}
