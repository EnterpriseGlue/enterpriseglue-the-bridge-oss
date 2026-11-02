import { RestoreFileFromCommitRequestSchema } from '@enterpriseglue/shared/schemas/starbase/file.js';

export type MissionControlEditorSelection = {
  isMissionControl: boolean;
  valid: boolean;
  error: string | null;
  processKey: string;
  decisionKey: string;
  version: number | null;
  engineId: string;
  commitId: string | null;
  fileVersion: number | null;
};

const canonical = (value: string | null): value is string => Boolean(value && value === value.trim());
const version = (value: string | null) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

// URL selectors describe a requested source. They grant no read or write authority.
export function parseMissionControlEditorSelection(search: string): MissionControlEditorSelection {
  const params = new URLSearchParams(search);
  const isMissionControl = params.getAll('source').includes('mission-control');
  const empty = { isMissionControl, valid: false, error: null, processKey: '', decisionKey: '', version: null, engineId: '', commitId: null, fileVersion: null };
  if (!isMissionControl) return empty;
  const keys = ['source', 'process', 'decision', 'version', 'engineId', 'commitId', 'fileVersion', 'deploymentId', 'mappingSource'];
  const processKey = params.get('process'), decisionKey = params.get('decision');
  const commitId = params.get('commitId'), fileVersion = version(params.get('fileVersion'));
  const engineId = params.get('engineId'), selectedVersion = version(params.get('version'));
  const savedSource = { ...(commitId !== null ? { commitId } : {}), ...(fileVersion !== null ? { fileVersionNumber: fileVersion } : {}) };
  if (keys.some(key => params.getAll(key).length > 1)
    || Boolean(processKey) === Boolean(decisionKey)
    || (params.has('process') && !canonical(processKey)) || (params.has('decision') && !canonical(decisionKey))
    || !canonical(engineId) || selectedVersion === null
    || (params.has('commitId') && !canonical(commitId))
    || (params.has('fileVersion') && fileVersion === null)
    || ((params.has('commitId') || params.has('fileVersion')) && !RestoreFileFromCommitRequestSchema.safeParse(savedSource).success)) {
    return { ...empty, error: 'The deployed selection is invalid or ambiguous. Open it again from Mission Control, or continue with your current draft.' };
  }
  return { isMissionControl, valid: true, error: null, processKey: processKey || '', decisionKey: decisionKey || '', version: selectedVersion, engineId, commitId, fileVersion };
}

export function matchesDeployedEditorBaseline(selection: MissionControlEditorSelection, latest: { id: string; fileVersionNumber?: number | null } | null | undefined): boolean {
  if (!selection.valid || !latest || (!selection.commitId && selection.fileVersion === null)) return false;
  return (!selection.commitId || selection.commitId === latest.id)
    && (selection.fileVersion === null || selection.fileVersion === latest.fileVersionNumber);
}
