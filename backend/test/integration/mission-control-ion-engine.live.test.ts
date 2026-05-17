import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fetch, FormData } from 'undici';
import type { createApp as CreateAppFn } from '../../../packages/backend-host/src/app.js';
import { cleanupEngines, cleanupStaleTestData, seedEngine, seedUser } from '../utils/seed.js';

const ION_ENGINE_BASE_URL = process.env.ION_ENGINE_BASE_URL?.replace(/\/$/, '') || '';
const runLiveIonTests = Boolean(ION_ENGINE_BASE_URL);

const prefix = `test_ion_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const bpmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:operaton="http://operaton.org/schema/1.0/bpmn"
  id="Definitions_enterpriseglue_ion_live"
  targetNamespace="https://enterpriseglue.com/ion-engine/live">
  <bpmn:process id="eg_ion_live" name="EnterpriseGlue ION Live Process" isExecutable="true" operaton:historyTimeToLive="30">
    <bpmn:startEvent id="StartEvent_eg_ion" name="Start">
      <bpmn:outgoing>Flow_start_task</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_auto" name="Automatic pass">
      <bpmn:incoming>Flow_start_task</bpmn:incoming>
      <bpmn:outgoing>Flow_task_end</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="EndEvent_eg_ion" name="Done">
      <bpmn:incoming>Flow_task_end</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_start_task" sourceRef="StartEvent_eg_ion" targetRef="Task_auto" />
    <bpmn:sequenceFlow id="Flow_task_end" sourceRef="Task_auto" targetRef="EndEvent_eg_ion" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_enterpriseglue_ion_live">
    <bpmndi:BPMNPlane id="BPMNPlane_enterpriseglue_ion_live" bpmnElement="eg_ion_live">
      <bpmndi:BPMNShape id="StartEvent_eg_ion_di" bpmnElement="StartEvent_eg_ion">
        <dc:Bounds x="152" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_auto_di" bpmnElement="Task_auto">
        <dc:Bounds x="240" y="80" width="120" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_eg_ion_di" bpmnElement="EndEvent_eg_ion">
        <dc:Bounds x="412" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_start_task_di" bpmnElement="Flow_start_task">
        <di:waypoint x="188" y="120" />
        <di:waypoint x="240" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_task_end_di" bpmnElement="Flow_task_end">
        <di:waypoint x="360" y="120" />
        <di:waypoint x="412" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

let userId = '';
let engineId = '';
let token = '';
let app: ReturnType<typeof CreateAppFn>;

async function deployLiveFixture() {
  const form = new FormData();
  form.set('deployment-name', `${prefix}-deployment`);
  form.set('enable-duplicate-filtering', 'true');
  form.set('deploy-changed-only', 'true');
  form.set('eg-ion-live.bpmn', new Blob([bpmnXml], { type: 'text/xml' }), 'eg-ion-live.bpmn');

  const response = await fetch(`${ION_ENGINE_BASE_URL}/deployment/create`, {
    method: 'POST',
    headers: {
      'X-EnterpriseGlue-Request-Id': `${prefix}-fixture-deploy`,
      'X-EnterpriseGlue-Operation-Class': 'engine.deploy',
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`ION fixture deployment failed: ${response.status} ${response.statusText} ${await response.text()}`);
  }
}

describe.skipIf(!runLiveIonTests)('Mission Control ION-Engine live integration', () => {
  beforeAll(async () => {
    await deployLiveFixture();
    await cleanupStaleTestData();

    const { createApp } = await import('../../../packages/backend-host/src/app.js');
    app = createApp({
      includeRateLimiting: false,
      includeDocs: false,
    });

    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-please-change-00000000000000';
    const user = await seedUser(prefix);
    userId = user.id;
    token = user.token;

    const engine = await seedEngine(userId, ION_ENGINE_BASE_URL, `${prefix}-engine`, 'ion');
    engineId = engine.id;
  });

  afterAll(async () => {
    await cleanupEngines(engineId ? [engineId] : []);
    if (userId) {
      const { getDataSource } = await import('@enterpriseglue/shared/db/data-source.js');
      const { User } = await import('@enterpriseglue/shared/db/entities/User.js');
      const dataSource = await getDataSource();
      await dataSource.getRepository(User).delete({ id: userId as any });
    }
  });

  it('operates a live ION process through EnterpriseGlue Mission Control APIs', async () => {
    const definitionsResponse = await request(app)
      .get('/t/default/mission-control-api/process-definitions')
      .query({ engineId, key: 'eg_ion_live', latest: 'true' })
      .set('Authorization', `Bearer ${token}`);

    expect(definitionsResponse.status).toBe(200);
    expect(definitionsResponse.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'eg_ion_live' }),
    ]));

    const definition = definitionsResponse.body[0];
    expect(definition.id).toEqual(expect.any(String));

    const xmlResponse = await request(app)
      .get(`/t/default/mission-control-api/process-definitions/${encodeURIComponent(definition.id)}/xml`)
      .query({ engineId })
      .set('Authorization', `Bearer ${token}`);

    expect(xmlResponse.status).toBe(200);
    expect(xmlResponse.body.bpmn20Xml).toContain('eg_ion_live');

    const startResponse = await request(app)
      .post('/t/default/mission-control-api/process-definitions/key/eg_ion_live/start')
      .set('Authorization', `Bearer ${token}`)
      .send({
        engineId,
        businessKey: `${prefix}-business-key`,
        variables: {
          approved: { value: true, type: 'Boolean' },
        },
      });

    expect(startResponse.status).toBe(200);
    expect(startResponse.body.id).toEqual(expect.any(String));

    const historyResponse = await request(app)
      .get(`/t/default/mission-control-api/history/process-instances/${startResponse.body.id}`)
      .query({ engineId })
      .set('Authorization', `Bearer ${token}`);

    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body.id).toBe(startResponse.body.id);
  });
});
