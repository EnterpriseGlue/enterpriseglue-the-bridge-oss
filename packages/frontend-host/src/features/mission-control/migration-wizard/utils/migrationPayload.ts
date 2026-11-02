import { MigrationPlanSchema, type MigrationPlan } from '@enterpriseglue/shared/schemas/mission-control/migration.js';
import { parseTypedVariableValue } from '../../process-instance-detail/components/variableValues.js';
export const canonicalId = (value: unknown): value is string => typeof value === 'string' && !!value && value === value.trim();
export function selectedInstances(input: unknown): string[] | null {
    const ids = Array.isArray(input) ? [...input] : null;
    return ids && ids.length <= 5000 && ids.every(canonicalId) && new Set(ids).size === ids.length ? ids : null;
}
export function mappedPlan(input: MigrationPlan | null, overrides: Record<number, string>, triggers: Record<number, boolean>, removed: Record<number, boolean>): MigrationPlan | null {
    if (!input)
        return null;
    return MigrationPlanSchema.parse({ ...input, instructions: input.instructions.flatMap((instruction, index) => removed[index] ? [] : [{
                ...instruction,
                targetActivityIds: Object.prototype.hasOwnProperty.call(overrides, index) ? (canonicalId(overrides[index]) ? [overrides[index]] : []) : [...instruction.targetActivityIds],
                ...(Object.prototype.hasOwnProperty.call(triggers, index) ? { updateEventTrigger: triggers[index] } : {}),
            }]) });
}
export type MigrationVariableRow = {
    name: string;
    type: string;
    value: string;
    scope: 'GLOBAL' | 'LOCAL';
};
export function migrationVariables(rows: MigrationVariableRow[]) {
    const names = new Set<string>();
    return Object.fromEntries(rows.map(row => {
        const name = row.name.trim();
        if (!name || name === '__proto__' || names.has(name))
            throw Error('Use distinct supported variable names.');
        names.add(name);
        if (row.scope !== 'GLOBAL')
            throw Error('Migration variables support global scope only.');
        if (!['String', 'Boolean', 'Long', 'Double', 'JSON', 'Date'].includes(row.type))
            throw Error('Select a supported migration variable type.');
        let value: unknown = row.value, type = row.type;
        if (['Boolean', 'Long', 'Double'].includes(type)) {
            if (!row.value.trim())
                throw Error('Typed variables require a value.');
            value = parseTypedVariableValue(row.value, type);
        }
        else if (type === 'JSON') {
            type = 'Json';
            try {
                value = JSON.stringify(JSON.parse(row.value), (_key, item) => {
                    if (typeof item === 'number' && !Number.isFinite(item))
                        throw Error('Nonfinite JSON');
                    return item;
                });
            }
            catch {
                throw Error('JSON variables require valid finite JSON.');
            }
        }
        return [name, { type, value }];
    }));
}
