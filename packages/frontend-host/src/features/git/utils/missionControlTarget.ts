import { LatestProjectDeploymentArtifactSchema, type FileDeploymentSummary } from '@enterpriseglue/shared/schemas/starbase/deployment-query.js';

export type MissionControlTarget = {
  engineId: string;
  path: '/mission-control/processes' | '/mission-control/decisions';
  keyParam: 'process' | 'decision';
  key: string;
  version: number;
};

export function getMissionControlTarget(row: Pick<FileDeploymentSummary, 'engineId' | 'artifacts'>, fileType: 'bpmn' | 'dmn'): MissionControlTarget | null {
  const desiredKind = fileType === 'dmn' ? 'decision' : 'process';
  const artifacts = Array.isArray(row.artifacts) ? row.artifacts : [];
  const matches = artifacts.filter(artifact => artifact?.kind === desiredKind);
  // A file can contain multiple runtime definitions. Do not guess which one the user meant.
  if (matches.length !== 1) return null;
  const best = matches[0];
  const key = best.key;
  const version = best.version;
  const engineId = row.engineId;
  if (typeof engineId !== 'string' || !engineId || engineId !== engineId.trim()
    || typeof key !== 'string' || !key || key !== key.trim()
    || !Number.isSafeInteger(version) || version <= 0) return null;
  return {
    engineId,
    path: fileType === 'dmn' ? '/mission-control/decisions' : '/mission-control/processes',
    keyParam: fileType === 'dmn' ? 'decision' : 'process',
    key,
    version,
  };
}

export type RuntimeLinkFile = { id: string; projectId: string; type: string };
const canonical = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value === value.trim();

export function selectLatestFileMissionControlTarget(file: RuntimeLinkFile | null | undefined, rows: unknown, engineId?: string | null) {
  if (!file || !canonical(file.id) || !canonical(file.projectId) || !canonical(engineId)
    || !['bpmn', 'dmn'].includes(file.type) || !Array.isArray(rows)) return null;
  const matches = rows.filter(row => row?.fileId === file.id && row?.engineId === engineId);
  if (matches.length !== 1) return null;
  const parsed = LatestProjectDeploymentArtifactSchema.safeParse(matches[0]);
  if (!parsed.success) return null;
  const row = parsed.data;
  if ((row.fileType !== null && row.fileType !== file.type) || !canonical(row.engineDeploymentId)) return null;
  const target = getMissionControlTarget(row, file.type as 'bpmn' | 'dmn');
  if (!target) return null;
  const artifact = row.artifacts.find(item => item.kind === target.keyParam)!;
  if (!canonical(artifact.id)) return null;
  return { ...target, definitionId: artifact.id, identity: JSON.stringify(row) };
}
