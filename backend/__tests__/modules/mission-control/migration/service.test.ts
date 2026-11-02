import { describe, it, expect } from 'vitest';
import { toEnginePlan } from '../../../../../packages/backend-host/src/modules/mission-control/migration/service.js';

describe('migration service', () => {
  describe('toEnginePlan', () => {
    it('converts body with sourceProcessDefinitionId', () => {
      const body = {
        sourceProcessDefinitionId: 'src-1',
        targetProcessDefinitionId: 'tgt-1',
        instructions: [
          { sourceActivityIds: ['a1'], targetActivityIds: ['b1'] },
        ],
      };
      
      const result = toEnginePlan(body);
      
      expect(result.sourceProcessDefinitionId).toBe('src-1');
      expect(result.targetProcessDefinitionId).toBe('tgt-1');
      expect(result.instructions).toHaveLength(1);
    });

    it('retains detached migration-plan variables for engine validation', () => {
      const input={sourceProcessDefinitionId:'src',targetProcessDefinitionId:'tgt',instructions:[],variables:{details:{type:'Json',value:'{"stage":"reviewed"}'}}};
      const result=toEnginePlan(input);
      expect(result.variables).toEqual(input.variables);
      input.variables.details.value='changed';
      expect(result.variables.details.value).toBe('{"stage":"reviewed"}');
    });

    it('converts body with sourceDefinitionId', () => {
      const body = {
        sourceDefinitionId: 'src-1',
        targetDefinitionId: 'tgt-1',
        overrides: [
          { sourceActivityId: 'a1', targetActivityId: 'b1' },
        ],
      };
      
      const result = toEnginePlan(body);
      
      expect(result.sourceProcessDefinitionId).toBe('src-1');
      expect(result.targetProcessDefinitionId).toBe('tgt-1');
      expect(result.instructions).toHaveLength(1);
    });

    it('handles empty overrides', () => {
      const body = {
        sourceDefinitionId: 'src-1',
        targetDefinitionId: 'tgt-1',
        overrides: [],
      };
      
      const result = toEnginePlan(body);
      
      expect(result.instructions).toHaveLength(0);
    });

    it('filters incomplete instructions', () => {
      const body = {
        sourceDefinitionId: 'src-1',
        targetDefinitionId: 'tgt-1',
        overrides: [
          { sourceActivityId: 'a1' }, // no target
          { targetActivityId: 'b1' }, // no source
        ],
      };
      
      const result = toEnginePlan(body);
      
      expect(result.instructions).toHaveLength(0);
    });
  });
});
