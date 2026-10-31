import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { camundaGetWithConnection } from '@enterpriseglue/shared/services/bpmn-engine-client.js';

// Real pinned Operaton HTTP transport; audit persistence is outside this fixture.
vi.mock('@enterpriseglue/shared/services/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: () => { throw Error('Unexpected fixture database access'); } }));

describe('real Operaton serialized variable values', () => {
  it('preserves JSON and scalar values through runtime, task and completed history reads', async () => {
    const baseUrl = process.env.OPERATON_VARIABLE_FIXTURE_URL;
    if (!baseUrl) throw Error('A disposable OPERATON_VARIABLE_FIXTURE_URL is required');
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/engine-rest'
      || url.username || url.password || url.search || url.hash) throw Error('The fixture must be a loopback Operaton endpoint');
    const key = `json_values_${randomUUID().replace(/-/g, '')}`;
    const connection = { id: key, baseUrl, authType: 'none' };
    let deploymentId: string | undefined;
    const json = async (path: string, body?: unknown) => {
      const response = await fetch(`${baseUrl}${path}`, { method: body === undefined ? 'GET' : 'POST',
        signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
      if (!response.ok) throw Error(`Owned Operaton fixture HTTP ${response.status}`);
      return response.status === 204 ? undefined : response.json();
    };
    try {
      const form = new FormData();
      form.set('deployment-name', key);
      form.set('process.bpmn', new Blob([`<?xml version="1.0" encoding="UTF-8"?>
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" targetNamespace="fixture">
          <bpmn:process id="${key}" isExecutable="true" camunda:historyTimeToLive="1">
            <bpmn:startEvent id="start"/><bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="review"/>
            <bpmn:userTask id="review" name="Review typed values"/><bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="end"/><bpmn:endEvent id="end"/>
          </bpmn:process>
        </bpmn:definitions>`], { type: 'application/xml' }), 'process.bpmn');
      const deployed = await fetch(`${baseUrl}/deployment/create`, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
      expect(deployed.status).toBe(200);
      deploymentId = (await deployed.json() as { id: string }).id;
      const expected = { tenant: 'fixture-a', nested: [1, true, null] };
      const instance = await json(`/process-definition/key/${key}/start`, { variables: {
        details: { type: 'Json', value: JSON.stringify(expected) }, text: { type: 'String', value: '{plain text}' },
        count: { type: 'Integer', value: 42 }, approved: { type: 'Boolean', value: true }, amount: { type: 'Double', value: 12.5 },
      } });
      const runtime = await camundaGetWithConnection<Record<string, unknown>>(connection, `/process-instance/${instance.id}/variables`);
      expect(runtime).toMatchObject({ details: { type: 'Json', value: expected }, text: { type: 'String', value: '{plain text}' },
        count: { type: 'Integer', value: 42 }, approved: { type: 'Boolean', value: true }, amount: { type: 'Double', value: 12.5 } });
      const tasks = await json(`/task?processInstanceId=${instance.id}`);
      expect(tasks).toHaveLength(1);
      expect(await camundaGetWithConnection(connection, `/task/${tasks[0].id}/variables`)).toMatchObject({ details: { type: 'Json', value: expected } });
      const edited = { ...expected, stage: 'reviewed' };
      await json(`/process-instance/${instance.id}/variables`, { modifications: { details: { type: 'Json', value: JSON.stringify(edited) } } });
      expect(await camundaGetWithConnection(connection, `/process-instance/${instance.id}/variables`)).toMatchObject({ details: { type: 'Json', value: edited } });
      await json(`/task/${tasks[0].id}/complete`, {});
      expect(await json(`/history/process-instance/${instance.id}`)).toMatchObject({ state: 'COMPLETED' });
      const activities = await camundaGetWithConnection<unknown[]>(connection, '/history/activity-instance', {
        processInstanceId: instance.id, sortBy: 'startTime', sortOrder: 'asc', firstResult: 0, maxResults: 200,
      });
      expect(activities).toHaveLength(3);
      const historic = await camundaGetWithConnection<Array<{ name: string; type: string; value: unknown }>>(connection,
        '/history/variable-instance', { processInstanceId: instance.id });
      expect(historic.find(variable => variable.name === 'details')).toMatchObject({ type: 'Json', value: edited });
    } finally {
      if (deploymentId) {
        const removed = await fetch(`${baseUrl}/deployment/${encodeURIComponent(deploymentId)}?cascade=true`,
          { method: 'DELETE', signal: AbortSignal.timeout(15000) });
        expect(removed.status).toBe(204);
      }
    }
  }, 60000);
});
