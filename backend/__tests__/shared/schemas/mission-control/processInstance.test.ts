import { describe, expect, it } from 'vitest';
import { ActivityInstanceListSchema, ProcessDefinitionSchema, ProcessInstanceDetailSchema, ProcessInstanceSchema, RuntimeActivityInstanceTreeSchema, VariablesSchema } from '@enterpriseglue/shared/schemas/mission-control/process.js';
import { VariableHistoryEntrySchema } from '@enterpriseglue/shared/schemas/mission-control/history.js';

describe('process instance transport contract', () => {
  it('keeps every normalized runtime state and adapter extension', () => {
    const instance = ProcessInstanceSchema.parse({
      id: 'instance-1',
      processDefinitionKey: 'payments',
      businessKey: 'order-42',
      version: 3,
      state: 'SUSPENDED',
      hasIncident: true,
      adapterDiagnostic: 'retained',
    });
    expect(instance).toMatchObject({ state: 'SUSPENDED', hasIncident: true, adapterDiagnostic: 'retained' });
  });

  it('accepts an Operaton completed-instance response without a business key', () => {
    const instance = ProcessInstanceDetailSchema.parse({
      id: '4c908379-a774-11f1-a3cc-5a297f77b652',
      businessKey: null,
      processDefinitionId: 'egprocess:5:4c722604-a774-11f1-a3cc-5a297f77b652',
      processDefinitionKey: 'egprocess',
      processDefinitionName: 'EnterpriseGlue authorization fixture',
      processDefinitionVersion: 5,
      startTime: '2026-09-03T08:48:56.778+0000',
      endTime: '2026-09-03T08:48:56.784+0000',
      durationInMillis: 6,
      state: 'COMPLETED',
    });

    expect(instance).toMatchObject({
      businessKey: null,
      processDefinitionId: 'egprocess:5:4c722604-a774-11f1-a3cc-5a297f77b652',
      processDefinitionName: 'EnterpriseGlue authorization fixture',
      processDefinitionVersion: 5,
      state: 'COMPLETED',
    });
  });

  it('keeps process-definition adapter extensions at the shared route boundary', () => {
    const definition = ProcessDefinitionSchema.parse({
      id: 'payments:3:abc', key: 'payments', name: 'Payments', version: 3, adapterDiagnostic: { retained: true },
    });
    expect(definition).toMatchObject({ key: 'payments', adapterDiagnostic: { retained: true } });
  });

  it('accepts the null version tag returned by Camunda-compatible engines', () => {
    const definition = ProcessDefinitionSchema.parse({
      id: 'payments:3:abc', key: 'payments', name: 'Payments', version: 3, versionTag: null,
    });

    expect(definition.versionTag).toBeNull();
  });

  it('validates recursive runtime activity trees while retaining adapter diagnostics', () => {
    const tree = RuntimeActivityInstanceTreeSchema.parse({ id: 'root', activityId: 'start', childActivityInstances: [{ id: 'child', activityId: 'task', adapterDiagnostic: true }] });
    expect(tree.childActivityInstances?.[0]).toMatchObject({ id: 'child', adapterDiagnostic: true });
  });

  it('keeps detail identifiers, action decisions, and adapter extensions in one contract', () => {
    const detail = ProcessInstanceDetailSchema.parse({
      id: 'instance-1',
      processDefinitionId: 'payments:3:abc',
      definitionId: 'payments:3:abc',
      processDefinitionKey: 'payments',
      runtimeActionDecisions: {
        suspension: { allowed: true }, retry: { allowed: false, reason: 'Denied' }, terminate: { allowed: false },
      },
      engineDiagnostic: { retained: true },
    });
    expect(detail).toMatchObject({ processDefinitionId: 'payments:3:abc', engineDiagnostic: { retained: true } });
  });

  it('keeps historic activity execution fields and adapter extensions', () => {
    const history = ActivityInstanceListSchema.parse([{
      id: 'activity-1',
      activityId: 'review-order',
      parentActivityInstanceId: null,
      executionId: 'execution-1',
      endTime: null,
      adapterDiagnostic: { retained: true },
    }]);
    expect(history[0]).toMatchObject({
      activityId: 'review-order', executionId: 'execution-1', adapterDiagnostic: { retained: true },
    });
  });

  it('keeps runtime variable metadata and adapter extensions', () => {
    const variables = VariablesSchema.parse({
      approvalReason: {
        value: 'Need manager sign-off',
        type: 'String',
        valueInfo: { serializationDataFormat: 'application/json' },
        adapterDiagnostic: { retained: true },
      },
    });
    expect(variables.approvalReason).toMatchObject({
      type: 'String', adapterDiagnostic: { retained: true },
    });
  });

  it('keeps normalized variable-history metadata in the shared row contract', () => {
    const entry = VariableHistoryEntrySchema.parse({
      id: 'detail-1',
      variableInstanceId: 'variable-1',
      variableName: 'approvalReason',
      value: 'Need manager sign-off',
      type: 'String',
      activityInstanceId: null,
      revision: 2,
    });
    expect(entry).toMatchObject({ variableName: 'approvalReason', revision: 2 });
  });
});
