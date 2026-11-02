import { canonicalId, selectedInstances } from './migrationPayload';
export interface MigrationSessionState {
    instanceIds: string[];
    engineId?: string;
    selectedKey?: string;
    selectedVersion?: number;
}
export function parseMigrationSession(input: unknown): MigrationSessionState | null {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return null;
    const value = input as Record<string, unknown>, ids = selectedInstances(value.instanceIds);
    if (!ids || (ids.length && !canonicalId(value.engineId)) || (value.engineId !== undefined && !canonicalId(value.engineId))
        || (value.selectedKey !== undefined && !canonicalId(value.selectedKey))
        || (value.selectedVersion !== undefined && (!Number.isSafeInteger(value.selectedVersion) || Number(value.selectedVersion) <= 0)))
        return null;
    return { instanceIds: ids, ...(value.engineId === undefined ? {} : { engineId: value.engineId as string }),
        ...(value.selectedKey === undefined ? {} : { selectedKey: value.selectedKey as string }), ...(value.selectedVersion === undefined ? {} : { selectedVersion: value.selectedVersion as number }) };
}
const key = (scope: string) => 'migration-wizard-state:v2:' + encodeURIComponent(scope);
export function loadMigrationSession(scope?: string): MigrationSessionState {
    if (!scope)
        return { instanceIds: [] };
    try {
        const raw = sessionStorage.getItem(key(scope));
        return raw ? parseMigrationSession(JSON.parse(raw)) || { instanceIds: [] } : { instanceIds: [] };
    }
    catch {
        return { instanceIds: [] };
    }
}
export function saveMigrationSession(data: MigrationSessionState, scope?: string) {
    const parsed = parseMigrationSession(data);
    if (!scope || !parsed)
        return;
    try {
        sessionStorage.setItem(key(scope), JSON.stringify(parsed));
    }
    catch { /* Storage is optional navigation convenience. */ }
}
