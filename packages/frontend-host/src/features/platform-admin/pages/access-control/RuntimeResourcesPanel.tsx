import { Button, DataTableSkeleton, Dropdown, InlineNotification, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag } from '@carbon/react';
import { parseApiError } from '../../../../shared/api/apiErrorUtils';
import type { RuntimeResource, RuntimeResourceReconciliationResult } from '../../hooks/useAuthzApi';
import type { RuntimeResourceEngineOption } from './runtimeResourceOptions';

export function RuntimeResourcesPanel({ engines, selectedEngineId, resources, loading, error, canManage, reconcilePending, reconcileError, reconcileResult, onSelectEngine, onReconcile }: {
  engines: RuntimeResourceEngineOption[]; selectedEngineId: string; resources: RuntimeResource[]; loading: boolean; error: unknown; canManage: boolean; reconcilePending: boolean; reconcileError: unknown; reconcileResult: RuntimeResourceReconciliationResult | undefined; onSelectEngine: (id: string) => void; onReconcile: () => void;
}) {
  const selectedEngine = engines.find((engine) => engine.id === selectedEngineId) || null;
  const processCount = resources.filter((resource) => resource.resourceKind === 'process_definition').length;
  const decisionCount = resources.filter((resource) => resource.resourceKind === 'decision_definition').length;

  return <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
    <div><h3 style={{ margin: 0 }}>Runtime Resources</h3><p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Sanitized process and decision inventory for resource-aware central engines. Inventory supports authorization decisions; it is not a copy of engine payload data.</p></div>
    <div style={{ display: 'flex', gap: 'var(--spacing-4)', alignItems: 'end', flexWrap: 'wrap' }}>
      <Dropdown id="runtime-resource-engine" titleText="Engine" label="Select an engine" items={engines} selectedItem={selectedEngine} itemToString={(item) => item?.name || ''} onChange={({ selectedItem }) => onSelectEngine(selectedItem?.id || '')} style={{ minWidth: 280 }} />
      <Button kind="secondary" size="sm" disabled={!selectedEngineId || !canManage || reconcilePending} onClick={onReconcile}>Reconcile inventory</Button>
      {selectedEngine && <Tag type="cool-gray">{processCount} processes</Tag>}
      {selectedEngine && <Tag type="cool-gray">{decisionCount} decisions</Tag>}
    </div>
    {Boolean(reconcileError) && <InlineNotification kind="error" lowContrast title="Runtime inventory could not be reconciled" subtitle={parseApiError(reconcileError, 'Request failed').message} hideCloseButton />}
    {reconcileResult && !reconcileError && <InlineNotification kind="success" lowContrast title="Inventory reconciled" subtitle={`${reconcileResult.created + reconcileResult.updated} runtime resources refreshed, ${reconcileResult.deactivated} deactivated; ${reconcileResult.deployments.created + reconcileResult.deployments.updated} deployment records and ${reconcileResult.deployments.artifactsCreated} artifacts reconciled.`} hideCloseButton />}
    {loading ? <DataTableSkeleton headers={[{ key: 'key', header: 'Resource' }]} rowCount={6} /> : error ? <InlineNotification kind="error" lowContrast title="Runtime resources could not be loaded" subtitle={parseApiError(error, 'Request failed').message} hideCloseButton /> : !selectedEngine ? <InlineNotification kind="info" lowContrast title="Select an engine" subtitle="Choose an engine to inspect its runtime resource inventory." hideCloseButton /> : resources.length === 0 ? <InlineNotification kind="info" lowContrast title="No runtime resources recorded" subtitle="Reconcile inventory after the engine is reachable or a deployment receipt has been received." hideCloseButton /> : <TableContainer><Table size="md"><TableHead><TableRow><TableHeader>Resource</TableHeader><TableHeader>Kind</TableHeader><TableHeader>Runtime tenant</TableHeader><TableHeader>Project</TableHeader><TableHeader>Source</TableHeader><TableHeader>Observed</TableHeader></TableRow></TableHead><TableBody>{resources.map((resource) => <TableRow key={resource.id}><TableCell style={{ overflowWrap: 'anywhere' }}>{resource.resourceKey}</TableCell><TableCell><Tag type={resource.resourceKind === 'process_definition' ? 'blue' : 'purple'} size="sm">{resource.resourceKind === 'process_definition' ? 'Process' : 'Decision'}</Tag></TableCell><TableCell>{resource.runtimeTenantId || '-'}</TableCell><TableCell>{resource.projectId || '-'}</TableCell><TableCell>{resource.source}</TableCell><TableCell>{new Date(resource.observedAt).toLocaleString()}</TableCell></TableRow>)}</TableBody></Table></TableContainer>}
  </div>;
}
