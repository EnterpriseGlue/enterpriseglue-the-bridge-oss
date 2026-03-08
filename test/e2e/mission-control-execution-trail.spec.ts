import { test, expect, type Page } from '@playwright/test';
import { getE2ECredentials, hasE2ECredentials } from './utils/credentials';

const shouldSkip = !hasE2ECredentials();
const instanceId = 'loop-demo-instance';
const engineId = 'engine-1';
const processDefinitionId = 'approval-process:1:demo';

const BPMN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="approval-process" isExecutable="true">
    <bpmn:startEvent id="start" name="Start" />
    <bpmn:sequenceFlow id="flow-1" sourceRef="start" targetRef="approveTask" />
    <bpmn:userTask id="approveTask" name="Assign Approver Group">
      <bpmn:multiInstanceLoopCharacteristics isSequential="true" />
    </bpmn:userTask>
    <bpmn:sequenceFlow id="flow-2" sourceRef="approveTask" targetRef="end" />
    <bpmn:endEvent id="end" name="End" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="approval-process">
      <bpmndi:BPMNShape id="Shape_start" bpmnElement="start">
        <dc:Bounds x="152" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_approveTask" bpmnElement="approveTask">
        <dc:Bounds x="250" y="80" width="140" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_end" bpmnElement="end">
        <dc:Bounds x="462" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Edge_flow_1" bpmnElement="flow-1">
        <di:waypoint x="188" y="120" />
        <di:waypoint x="250" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Edge_flow_2" bpmnElement="flow-2">
        <di:waypoint x="390" y="120" />
        <di:waypoint x="462" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function login(page: Page) {
  const { email, password } = getE2ECredentials();
  if (!email || !password) throw new Error('Missing E2E credentials');

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

async function stubExecutionTrail(page: Page) {
  await page.route('**/engines-api/engines**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: engineId, name: 'Demo Engine', baseUrl: 'http://localhost:9080/engine-rest', myRole: 'owner' },
      ]),
    });
  });

  await page.route(`**/mission-control-api/history/process-instances/${instanceId}**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: instanceId,
        processDefinitionId,
        processDefinitionKey: 'approval-process',
        processDefinitionName: 'Approval Process',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-01T00:00:20Z',
        state: 'COMPLETED',
      }),
    });
  });

  await page.route('**/mission-control-api/process-definitions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: processDefinitionId, key: 'approval-process', name: 'Approval Process', version: 1 },
      ]),
    });
  });

  await page.route('**/mission-control-api/process-definitions/*/xml**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ bpmn20Xml: BPMN_XML }),
    });
  });

  await page.route(`**/mission-control-api/process-instances/${instanceId}/variables**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  await page.route(`**/mission-control-api/history/variable-instances?processInstanceId=${instanceId}**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route(`**/mission-control-api/process-instances/${instanceId}/history/activity-instances**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'start-hist',
          activityInstanceId: 'start-inst',
          activityId: 'start',
          activityName: 'Start',
          activityType: 'startEvent',
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-01-01T00:00:01Z',
          durationInMillis: 1000,
        },
        {
          id: 'approve-hist-1',
          activityInstanceId: 'approve-inst-1',
          activityId: 'approveTask',
          activityName: 'Assign Approver Group',
          activityType: 'userTask',
          executionId: 'approve-exec-1',
          taskId: 'approve-task-1',
          startTime: '2024-01-01T00:00:02Z',
          endTime: '2024-01-01T00:00:07Z',
          durationInMillis: 5000,
        },
        {
          id: 'approve-hist-2',
          activityInstanceId: 'approve-inst-2',
          activityId: 'approveTask',
          activityName: 'Assign Approver Group',
          activityType: 'userTask',
          executionId: 'approve-exec-2',
          taskId: 'approve-task-2',
          startTime: '2024-01-01T00:00:08Z',
          endTime: '2024-01-01T00:00:12Z',
          durationInMillis: 4000,
        },
        {
          id: 'end-hist',
          activityInstanceId: 'end-inst',
          activityId: 'end',
          activityName: 'End',
          activityType: 'endEvent',
          startTime: '2024-01-01T00:00:19Z',
          endTime: '2024-01-01T00:00:20Z',
          durationInMillis: 1000,
        },
      ]),
    });
  });

  await page.route(`**/mission-control-api/process-instances/${instanceId}/incidents**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route(`**/mission-control-api/process-instances/${instanceId}/jobs**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route(`**/mission-control-api/process-instances/${instanceId}/failed-external-tasks**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route(`**/t/default/mission-control-api/process-instances/${instanceId}/execution-details**`, async (route) => {
    const url = new URL(route.request().url());
    const activityInstanceId = url.searchParams.get('activityInstanceId');
    const executionId = url.searchParams.get('executionId');
    const taskId = url.searchParams.get('taskId');

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        activityInstanceId,
        executionId,
        taskId,
        variables: [
          {
            id: 'var-1',
            name: 'approvalReason',
            type: 'String',
            value: 'Loop approval step',
            createTime: '2024-01-01T00:00:03Z',
          },
        ],
        tasks: [
          {
            id: taskId,
            name: 'Assign Approver Group',
            assignee: 'demo.user',
            startTime: '2024-01-01T00:00:02Z',
            endTime: '2024-01-01T00:00:07Z',
          },
        ],
        decisions: [],
        userOperations: [],
      }),
    });
  });
}

test.describe('Mission Control execution trail', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('renders a multi-instance step from dummy data and opens lazy execution details', async ({ page }) => {
    await login(page);
    await stubExecutionTrail(page);

    await page.evaluate(({ selectedEngineId }) => {
      window.localStorage.setItem('engine-selector', JSON.stringify({ state: { selectedEngineId }, version: 0 }));
    }, { selectedEngineId: engineId });

    await page.goto(`/mission-control/processes/instances/${instanceId}`);

    await expect(page.getByRole('heading', { name: 'Execution Trail' })).toBeVisible();
    await expect(page.getByText('Assign Approver Group')).toBeVisible();
    await expect(page.getByTitle(/Sequential multi-instance/i)).toBeVisible();

    await page.getByLabel('Expand Assign Approver Group').click();
    await expect(page.locator('.cds--overflow-menu')).toHaveCount(4);

    await page.locator('.cds--overflow-menu').nth(1).click();
    await page.getByRole('menuitem', { name: 'Details' }).click();

    await expect(page.getByText('Variable snapshots').first()).toBeVisible();
    await expect(page.getByText('approvalReason')).toBeVisible();
    await expect(page.getByText('Loop approval step')).toBeVisible();
  });
});
