import { apiClient } from '../../../../shared/api/client.js';
import { MigrationPlanSchema, MigrationGenerateRequestSchema, MigrationExecuteRequestSchema, MigrationPlanValidationRequestSchema, MigrationValidationResultSchema, MigrationAsyncExecuteResponseSchema, MigrationDirectExecuteResponseSchema, MigrationPreviewResponseSchema, MigrationActiveSourcesResponseSchema, type MigrationPlan, type MigrationExecuteRequest, } from '@enterpriseglue/shared/schemas/mission-control/migration.js';
import { canonicalId } from '../utils/migrationPayload.js';
export { fetchProcessDefinitionXml } from '../../shared/api/definitions.js';
export type { MigrationInstruction, MigrationPlan } from '@enterpriseglue/shared/schemas/mission-control/migration.js';
export type { MigrationValidationResult as MigrationValidationReport } from '@enterpriseglue/shared/schemas/mission-control/migration.js';
export type MigrationExecution = Omit<MigrationExecuteRequest, 'plan'> & {
    migrationPlan: MigrationPlan;
};
function engine(id?: string) {
    if (!canonicalId(id))
        throw Error('Select an engine');
    return id;
}
function plan(input: unknown) {
    const parsed = MigrationPlanSchema.safeParse(input);
    if (!parsed.success || !canonicalId(parsed.data.sourceProcessDefinitionId) || !canonicalId(parsed.data.targetProcessDefinitionId)
        || !Array.isArray((input as any)?.instructions))
        throw Error('Migration plan could not be verified');
    return parsed.data;
}
export async function generateMigrationPlan(source: string, target: string, engineId?: string, updateEventTriggers?: boolean): Promise<MigrationPlan> {
    if (!canonicalId(source) || !canonicalId(target))
        throw Error('Select source and target definitions');
    const request = MigrationGenerateRequestSchema.parse({ engineId: engine(engineId), sourceProcessDefinitionId: source, targetProcessDefinitionId: target,
        ...(updateEventTriggers === undefined ? {} : { updateEventTriggers }) });
    const result = plan(await apiClient.post<unknown>('/mission-control-api/migration/generate', structuredClone(request), { credentials: 'include' }));
    if (result.sourceProcessDefinitionId !== source || result.targetProcessDefinitionId !== target)
        throw Error('Migration plan targets changed');
    return result;
}
export async function validateMigrationPlan(input: MigrationPlan, ids?: string[], engineId?: string, variables?: MigrationExecuteRequest['variables']) {
    const request = MigrationPlanValidationRequestSchema.parse({ engineId: engine(engineId), plan: plan({ ...input, ...(variables === undefined ? {} : { variables }) }), ...(ids === undefined ? {} : { processInstanceIds: ids }) });
    const raw = await apiClient.post<unknown>('/mission-control-api/migration/plan/validate', structuredClone(request), { credentials: 'include' });
    if (!Array.isArray((raw as any)?.instructionReports))
        throw Error('Migration validation could not be verified');
    return MigrationValidationResultSchema.parse(raw);
}
function execution(input: MigrationExecution) {
    const { migrationPlan, ...rest } = input;
    return MigrationExecuteRequestSchema.parse({ ...rest, engineId: engine(rest.engineId), plan: plan(migrationPlan) });
}
export async function executeMigration(input: MigrationExecution) {
    const request = structuredClone(execution(input));
    return MigrationDirectExecuteResponseSchema.parse(await apiClient.post<unknown>('/mission-control-api/migration/execute-direct', request, { credentials: 'include' }));
}
export async function executeMigrationAsync(input: MigrationExecution) {
    const request = structuredClone(execution(input));
    const receipt = MigrationAsyncExecuteResponseSchema.parse(await apiClient.post<unknown>('/mission-control-api/migration/execute-async', request, { credentials: 'include' }));
    if (!canonicalId(receipt.id))
        throw Error('Migration batch could not be verified');
    return receipt;
}
export async function previewMigration(input: MigrationPlan, ids: string[], engineId?: string) {
    return MigrationPreviewResponseSchema.parse(await apiClient.post<unknown>('/mission-control-api/migration/preview', structuredClone({ engineId: engine(engineId), plan: plan(input), processInstanceIds: ids }), { credentials: 'include' }));
}
export async function activeMigrationSources(ids: string[], engineId?: string) {
    return MigrationActiveSourcesResponseSchema.parse(await apiClient.post<unknown>('/mission-control-api/migration/active-sources', { engineId: engine(engineId), processInstanceIds: [...ids] }, { credentials: 'include' }));
}
