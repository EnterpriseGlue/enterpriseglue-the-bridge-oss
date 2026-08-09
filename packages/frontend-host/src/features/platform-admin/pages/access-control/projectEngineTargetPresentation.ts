import type { DeploymentEligibilityResult, ProjectEngineTarget, ProjectEngineTargetMode, ProjectEngineTargetSource } from '../../hooks/useAuthzApi';

export const projectEngineTargetHeaders = [
  { key: 'project', header: 'Project' }, { key: 'engine', header: 'Engine' }, { key: 'environment', header: 'Environment' },
  { key: 'status', header: 'Status' }, { key: 'source', header: 'Source' }, { key: 'modes', header: 'Modes' },
  { key: 'approval', header: 'Approval' }, { key: 'external', header: 'External refs' }, { key: 'diagnostics', header: 'Diagnostics' }, { key: 'actions', header: '' },
];

export const projectEngineTargetModes: Array<{ id: ProjectEngineTargetMode; label: string }> = [
  { id: 'manual', label: 'Manual' }, { id: 'ci', label: 'CI' }, { id: 'api', label: 'API' }, { id: 'import', label: 'Import' },
];

const sourceOwned = new Set<ProjectEngineTargetSource>(['ci', 'api', 'external', 'system', 'automation', 'config']);

export const projectEngineTargetLabel = (value: string) => value.split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
export const isSourceOwnedProjectTarget = (target: ProjectEngineTarget) => sourceOwned.has(target.source) && !(target.source === 'config' && target.ownershipMode === 'config_warn');
export const formatProjectEngineTargetModes = (target: ProjectEngineTarget) => [target.allowManualDeploy ? 'Manual' : '', target.allowCiDeploy ? 'CI' : '', target.allowApiDeploy ? 'API' : '', target.allowImport ? 'Import' : ''].filter(Boolean).join(', ') || '-';
export const formatProjectEngineTargetExternalRefs = (target: ProjectEngineTarget) => [target.externalSystemId ? `system=${target.externalSystemId}` : '', target.externalProjectId ? `project=${target.externalProjectId}` : '', target.externalEngineId ? `engine=${target.externalEngineId}` : '', target.externalTargetId ? `target=${target.externalTargetId}` : ''].filter(Boolean).join(', ') || '-';
export const formatProjectEngineTargetDiagnostics = (target: ProjectEngineTarget) => [target.policyTags.length ? `Policies: ${target.policyTags.join(', ')}` : '', target.diagnostics ? Object.entries(target.diagnostics).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(', ') : ''].filter(Boolean).join(' | ') || '-';
export const formatDeploymentEligibility = (result: DeploymentEligibilityResult) => result.allowed ? 'Allowed' : result.reasons.length ? result.reasons.join('; ') : 'Denied';
