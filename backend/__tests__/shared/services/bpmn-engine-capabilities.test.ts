import { describe, expect, it } from 'vitest';
import { getEngineCapabilities } from '@enterpriseglue/shared/services/bpmn-engine-capabilities.js';

describe('bpmn-engine-capabilities', () => {
  it('marks ION as certified and Operaton/Camunda 7 as compatible', () => {
    expect(getEngineCapabilities('ion')).toMatchObject({
      type: 'ion',
      compatibilityProfile: 'camunda7-rest',
      supportLevel: 'certified',
    });
    expect(getEngineCapabilities('operaton')).toMatchObject({
      type: 'operaton',
      supportLevel: 'compatible',
    });
    expect(getEngineCapabilities('camunda7')).toMatchObject({
      type: 'camunda7',
      supportLevel: 'compatible',
    });
  });

  it('falls back unknown legacy types to Camunda 7 compatibility', () => {
    const capabilities = getEngineCapabilities('legacy');

    expect(capabilities).toMatchObject({
      type: 'camunda7',
      compatibilityProfile: 'camunda7-rest',
      supportLevel: 'compatible',
    });
    expect(capabilities.operations).toEqual(expect.arrayContaining([
      'engine.read',
      'engine.deploy',
      'engine.instance.mutate',
      'engine.task.mutate',
      'engine.job.mutate',
      'engine.batch.admin',
    ]));
  });
});
