import { describe, expect, it } from 'vitest';
import { mappedPlan, migrationVariables, selectedInstances } from '@src/features/mission-control/migration-wizard/utils/migrationPayload';
import { MigrationExecuteRequestSchema } from '@enterpriseglue/shared/schemas/mission-control/migration.js';
const plan = { sourceProcessDefinitionId: 'source', targetProcessDefinitionId: 'target', instructions: [{ sourceActivityIds: ['a', 'b'], targetActivityIds: ['c', 'd'], updateEventTrigger: true }, { sourceActivityIds: ['e'], targetActivityIds: ['f'] }] };
describe('migration wire payload', () => {
    it('preserves every canonical target and explicit false trigger while applying removal and overrides', () => {
        expect(mappedPlan(plan, {}, { 0: false }, { 1: true })).toEqual({ ...plan, instructions: [{ ...plan.instructions[0], updateEventTrigger: false }] });
        expect(mappedPlan(plan, { 0: 'replacement' }, {}, {})?.instructions[0].targetActivityIds).toEqual(['replacement']);
        expect(mappedPlan(plan, { 0: undefined as any }, {}, {})?.instructions[0].targetActivityIds).toEqual([]);
        expect(plan.instructions[0].targetActivityIds).toEqual(['c', 'd']);
    });
    it('builds valid engine-native global variable values without losing constructor-like names', () => {
        const rows = [{ name: 'payload', type: 'JSON', value: '{"nested":[1,true,null]}' }, { name: 'count', type: 'Long', value: '42' }, { name: 'approved', type: 'Boolean', value: 'true' }, { name: 'constructor', type: 'String', value: 'text' }].map(r => ({ ...r, scope: 'GLOBAL' as const }));
        const variables = migrationVariables(rows);
        expect(variables).toEqual({ payload: { type: 'Json', value: '{"nested":[1,true,null]}' }, count: { type: 'Long', value: 42 }, approved: { type: 'Boolean', value: true }, constructor: { type: 'String', value: 'text' } });
        expect(MigrationExecuteRequestSchema.safeParse({ engineId: 'engine-a', plan: mappedPlan(plan, {}, {}, {}), variables, auditReason: 'Fixture' }).success).toBe(true);
    });
    it.each([{ name: '', type: 'String', value: 'x', scope: 'GLOBAL' }, { name: '__proto__', type: 'String', value: 'x', scope: 'GLOBAL' }, { name: 'x', type: 'String', value: 'x', scope: 'LOCAL' },
        { name: 'x', type: 'Boolean', value: 'anything', scope: 'GLOBAL' }, { name: 'x', type: 'Long', value: '1.5', scope: 'GLOBAL' }, { name: 'x', type: 'Long', value: '9007199254740993', scope: 'GLOBAL' },
        { name: 'x', type: 'Long', value: '0x10', scope: 'GLOBAL' }, { name: 'x', type: 'Double', value: 'Infinity', scope: 'GLOBAL' }, { name: 'x', type: 'JSON', value: '{', scope: 'GLOBAL' },
        { name: 'x', type: 'JSON', value: '1e999', scope: 'GLOBAL' }, { name: 'x', type: 'Unknown', value: 'x', scope: 'GLOBAL' }])('rejects unsupported variable %j before execution', row => expect(() => migrationVariables([row as any])).toThrow());
    it('rejects duplicate variable names rather than overwriting an earlier value', () => expect(() => migrationVariables([{ name: 'x', type: 'String', value: 'one', scope: 'GLOBAL' }, { name: ' x ', type: 'String', value: 'two', scope: 'GLOBAL' }])).toThrow());
    it.each([null, {}, [''], [' id'], ['a', 'a'], [1], new Array(1)])('rejects ambiguous selected instance input %j', input => expect(selectedInstances(input)).toBeNull());
});
