import { expect, test, type Page, type Route } from '@playwright/test';

import { MockBrowserIdentityStack } from './utils/mockIdentityStack';
import { captureManualScreenshot } from './utils/manualScreenshots';

const engineId = 'engine-operaton-production';
const instanceId = 'invoice-incident-42';
const batchId = 'batch-retry-invoice-42';
const pluginId = 'io.enterpriseglue.ion-support';
const pluginVersion = '0.1.0';
const pluginEntryUrl = `/_enterpriseglue/plugins/${pluginId}/${pluginVersion}/frontend/index.js`;
const now = '2026-08-19T09:30:00.000Z';

const engine = {
  id: engineId,
  name: 'Production Operaton',
  baseUrl: 'https://operaton.example.test/engine-rest',
  type: 'operaton',
  version: '1.2.0',
  connectionMode: 'customer_sidecar',
  runtimeAccessScope: 'resource_aware',
  tenancyMode: 'dedicated',
  tenantMappingStrategy: 'engine_tenant_id',
  lifecycleStatus: 'active',
  registrationSource: 'manual',
  capabilityStatus: 'in_sync',
  externalId: null,
  environmentTagId: null,
  ownershipMode: 'manual',
  createdAt: Date.parse(now),
  updatedAt: Date.parse(now),
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function supportPluginManifest() {
  const slots = [
    'mission-control.engine.actions.v1',
    'mission-control.incident.actions.v1',
    'mission-control.failed-job.actions.v1',
    'mission-control.process-instance.actions.v1',
  ];
  return {
    apiVersion: 'plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePlugin',
    metadata: {
      id: pluginId,
      version: pluginVersion,
      displayName: 'ION Support Agent',
      publisher: 'io.enterpriseglue',
    },
    compatibility: {
      host: '^0.4.0',
      sdk: '^0.1.0',
      frontendProtocol: 1,
      requiredSlots: slots,
    },
    deployment: {
      frontend: {
        entry: 'frontend/index.js',
        sha256: 'a'.repeat(64),
        shared: {
          react: '19.2.6',
          reactDom: '19.2.6',
          router: '7.18.1',
          carbonReact: '1.107.0',
          pluginSdk: '0.1.0',
        },
      },
    },
    scope: { installation: 'deployment', enablement: 'tenant' },
    permissions: { required: [], optional: [] },
    network: { egressPolicy: 'none' },
    entitlement: { provider: 'none' },
    dependencies: [],
    conflicts: [],
    events: { subscriptions: [] },
    jobs: { fixedSchedules: [] },
    contributions: slots.map((slot) => ({
      id: `${pluginId}.${slot}`,
      kind: 'slot',
      slot,
    })),
  };
}

/**
 * This is deliberately an executable fixture instead of a static markup mock.
 * It is loaded through the regular browser plugin bootstrap so each screenshot
 * proves the host's slot location and authorization boundary, too.
 */
const supportPluginModule = `
  const shared = globalThis.__ENTERPRISEGLUE_PLUGIN_SHARED_V1__;
  const React = shared.react;
  const { Button } = shared.carbon;
  const labels = {
    'mission-control.engine.actions.v1': 'Analyze issue',
    'mission-control.incident.actions.v1': 'Analyze issue',
    'mission-control.failed-job.actions.v1': 'Analyze issue',
    'mission-control.process-instance.actions.v1': 'Analyze issue',
  };
  function SupportAction(props) {
    const label = labels[props.slot] || 'Analyze support context';
    const inverse = props.slot === 'mission-control.process-instance.actions.v1';
    return React.createElement(Button, {
      kind: inverse ? 'ghost' : 'tertiary',
      size: 'sm',
      style: {
        flex: '0 0 auto',
        inlineSize: 'max-content',
        minInlineSize: 0,
        whiteSpace: 'nowrap',
        ...(inverse
          ? { color: 'var(--cds-text-on-color)' }
          : {}),
      },
      'data-testid': 'ion-support-' + props.slot,
      'aria-label': label + ' with ION Support',
      title: label + ' with ION Support',
    }, label);
  }
  export default {
    apiVersion: 'frontend.plugin.enterpriseglue.io/v1',
    pluginId: '${pluginId}',
    version: '${pluginVersion}',
    activate: () => ({
      slots: Object.keys(labels).map((slot) => ({
        id: '${pluginId}.' + slot,
        slot,
        component: SupportAction,
      })),
    }),
  };
`;

async function installSupportPluginFixture(page: Page) {
  const identityStack = new MockBrowserIdentityStack();
  await identityStack.install(page, process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173');

  // Register this after the identity fixture: Playwright evaluates the latest
  // matching handler first, which lets the screenshot principal read the
  // scoped engine context without granting any destructive permission.
  await page.route('**/api/authz/me/permissions', (route) => json(route, {
    userId: 'browser-admin-user',
    tenantId: null,
    platform: [
      'platform:dashboard:view',
      'platform:settings:view',
      'platform:settings:manage',
      'platform:engine:create',
    ],
    projects: [],
    engines: [{
      resourceId: engineId,
      permissions: ['engine:instance:view'],
      runtimePermissions: [],
    }],
    generatedAt: Date.parse(now),
    authorizationVersion: 'support-touchpoints-v1',
  }));

  await page.route('**/api/plugins/v1/frontend', (route) => json(route, {
    apiVersion: 'frontend-bootstrap.plugin.enterpriseglue.io/v1',
    revision: 1,
    issues: [],
    plugins: [{
      pluginId,
      version: pluginVersion,
      displayName: 'ION Support Agent',
      manifest: supportPluginManifest(),
      entryUrl: pluginEntryUrl,
    }],
  }));
  await page.route(/\/_enterpriseglue\/plugins\/io\.enterpriseglue\.ion-support\/0\.1\.0\/frontend\/index\.js(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: supportPluginModule,
  }));

  await page.route('**/engines-api/engines**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/engines/${engineId}/health`)) {
      return json(route, { status: 'connected', latencyMs: 24, version: '1.2.0' });
    }
    return json(route, [engine]);
  });
  await page.route('**/engines-api/environment-tags', (route) => json(route, []));
  await page.route('**/api/auth/platform-settings', (route) => json(route, {
    engineOnboardingMode: 'manual_allowed',
    engineAccessAuthority: 'manual',
    credentiallessCustomerSidecarsEnabled: true,
    governanceBehavior: { manualEngineRegistrationAllowed: true },
  }));
  await page.route('**/api/authz/runtime-resources**', (route) => json(route, []));
  await page.route('**/api/authz/role-assignments**', (route) => json(route, []));
  await page.route('**/api/authz/project-engine-targets**', (route) => json(route, []));
  await page.route('**/api/admin/projects**', (route) => json(route, []));

  await page.route('**/mission-control-api/batches**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/batches/${batchId}`)) {
      return json(route, {
        batch: {
          id: batchId,
          type: 'Process instance retry',
          status: 'FAILED',
          progress: 100,
          camundaBatchId: 'operaton-batch-42',
          totalJobs: 3,
          jobsCreated: 3,
          createdAt: now,
          lastError: 'Retry batch stopped after an incident in the invoice workflow.',
        },
        engine: { totalJobs: 3, jobsCreated: 3 },
        statistics: { completedJobs: 2, failedJobs: 1, remainingJobs: 0 },
        failedJobDetails: [{
          id: 'job-invoice-42',
          jobDefinitionId: 'invoice-service-task:42',
          processInstanceId: instanceId,
          exceptionMessage: 'Connector timeout after retries were exhausted.',
          stacktrace: 'org.operaton.bpm.engine.ProcessEngineException: connector timeout',
        }],
        runtimeActionDecisions: {
          suspension: { allowed: false, reason: 'Completed batches cannot be paused.' },
          cancel: { allowed: false, reason: 'Failed batches cannot be canceled.' },
        },
      });
    }
    return json(route, [{
      id: batchId,
      type: 'Process instance retry',
      status: 'FAILED',
      progress: 100,
      camundaBatchId: 'operaton-batch-42',
      createdAt: now,
      runtimeActionDecisions: {
        suspension: { allowed: false },
        cancel: { allowed: false },
        recordDelete: { allowed: false },
      },
    }]);
  });

  await installProcessInstanceFixture(page);
}

async function installProcessInstanceFixture(page: Page) {
  const definitionId = 'invoice-approval:3:42';
  await page.route(`**/mission-control-api/history/process-instances/${instanceId}**`, (route) => json(route, {
    id: instanceId,
    processDefinitionId: definitionId,
    processDefinitionKey: 'invoice-approval',
    processDefinitionName: 'Invoice approval',
    startTime: '2026-08-19T08:45:00.000Z',
    state: 'ACTIVE',
  }));
  await page.route(`**/mission-control-api/process-instances/${instanceId}?**`, (route) => json(route, {
    id: instanceId,
    definitionId,
    suspended: false,
    runtimeActionDecisions: {
      suspension: { allowed: false, reason: 'Read-only screenshot fixture.' },
      retry: { allowed: false, reason: 'Read-only screenshot fixture.' },
      modify: { allowed: false, reason: 'Read-only screenshot fixture.' },
      terminate: { allowed: false, reason: 'Read-only screenshot fixture.' },
      variablesUpdate: { allowed: false, reason: 'Read-only screenshot fixture.' },
    },
  }));
  await page.route('**/mission-control-api/process-definitions**', (route) => json(route, [{
    id: definitionId,
    key: 'invoice-approval',
    name: 'Invoice approval',
    version: 3,
  }]));
  await page.route('**/mission-control-api/process-definitions/*/xml**', (route) => json(route, {
    bpmn20Xml: `<?xml version="1.0" encoding="UTF-8"?>
      <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions">
        <bpmn:process id="invoice-approval" isExecutable="true">
          <bpmn:startEvent id="start" name="Start" />
          <bpmn:sequenceFlow id="flow-start" sourceRef="start" targetRef="sendInvoice" />
          <bpmn:serviceTask id="sendInvoice" name="Send invoice" />
          <bpmn:sequenceFlow id="flow-end" sourceRef="sendInvoice" targetRef="end" />
          <bpmn:endEvent id="end" name="End" />
        </bpmn:process>
        <bpmndi:BPMNDiagram id="Diagram">
          <bpmndi:BPMNPlane id="Plane" bpmnElement="invoice-approval">
            <bpmndi:BPMNShape id="Shape_start" bpmnElement="start"><dc:Bounds x="150" y="100" width="36" height="36" /></bpmndi:BPMNShape>
            <bpmndi:BPMNShape id="Shape_sendInvoice" bpmnElement="sendInvoice"><dc:Bounds x="250" y="78" width="150" height="80" /></bpmndi:BPMNShape>
            <bpmndi:BPMNShape id="Shape_end" bpmnElement="end"><dc:Bounds x="465" y="100" width="36" height="36" /></bpmndi:BPMNShape>
            <bpmndi:BPMNEdge id="Edge_start" bpmnElement="flow-start"><di:waypoint x="186" y="118" /><di:waypoint x="250" y="118" /></bpmndi:BPMNEdge>
            <bpmndi:BPMNEdge id="Edge_end" bpmnElement="flow-end"><di:waypoint x="400" y="118" /><di:waypoint x="465" y="118" /></bpmndi:BPMNEdge>
          </bpmndi:BPMNPlane>
        </bpmndi:BPMNDiagram>
      </bpmn:definitions>`,
  }));
  await page.route(`**/mission-control-api/process-instances/${instanceId}/variables**`, (route) => json(route, {
    invoiceReference: { type: 'String', value: 'INV-2026-0042' },
  }));
  await page.route(`**/mission-control-api/history/variable-instances?processInstanceId=${instanceId}**`, (route) => json(route, []));
  await page.route(`**/mission-control-api/process-instances/${instanceId}/history/activity-instances**`, (route) => json(route, [{
    id: 'service-task-history',
    activityInstanceId: 'service-task-instance',
    activityId: 'sendInvoice',
    activityName: 'Send invoice',
    activityType: 'serviceTask',
    startTime: '2026-08-19T08:46:00.000Z',
  }]));
  await page.route(`**/mission-control-api/process-instances/${instanceId}/activity-instances**`, (route) => json(route, {
    id: 'process-root',
    activityId: 'invoice-approval',
    activityName: 'Invoice approval',
    activityType: 'processScope',
    childActivityInstances: [],
    childTransitionInstances: [],
  }));
  await page.route(`**/mission-control-api/process-instances/${instanceId}/incidents**`, (route) => json(route, [{
    id: 'incident-invoice-42',
    activityId: 'sendInvoice',
    incidentType: 'failedJob',
    configuration: 'job-invoice-42',
    incidentTimestamp: now,
    incidentMessage: 'Connector timeout after retries were exhausted.',
  }]));
  await page.route(`**/mission-control-api/process-instances/${instanceId}/jobs**`, (route) => json(route, [{
    id: 'job-invoice-42',
    retries: 0,
    dueDate: now,
    exceptionMessage: 'Connector timeout after retries were exhausted.',
    exceptionStacktrace: 'org.operaton.bpm.engine.ProcessEngineException: connector timeout',
  }]));
  await page.route(`**/mission-control-api/process-instances/${instanceId}/failed-external-tasks**`, (route) => json(route, []));
  await page.route('**/mission-control-api/decision-instances/**', (route) => json(route, []));
}

test.describe('ION Support Agent contextual touchpoints', () => {
  test('captures every supported OSS context at a MacBook viewport @support-touchpoints', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installSupportPluginFixture(page);

    await page.goto('/engines');
    await expect(page.getByText('Production Operaton', { exact: true })).toBeVisible();
    await expect(page.getByTestId('ion-support-mission-control.engine.actions.v1')).toBeVisible();
    await captureManualScreenshot(page, '01-support-engine-actions-1440x900.jpg');

    await page.goto(`/mission-control/processes/instances/${instanceId}`);
    const processIncidentBanner = page.getByRole('region', { name: 'Process incident' });
    await expect(processIncidentBanner).toBeVisible();
    await expect(
      processIncidentBanner.getByTestId('ion-support-mission-control.process-instance.actions.v1'),
    ).toBeVisible();
    await expect(processIncidentBanner.getByRole('button', { name: 'View incidents' })).toBeVisible();
    await captureManualScreenshot(page, '02-support-process-instance-1440x900.jpg');

    await page.getByRole('button', { name: 'View incidents' }).click();
    await expect(page.getByRole('dialog', { name: /Incident — sendInvoice/ })).toBeVisible();
    await expect(page.getByTestId('ion-support-mission-control.incident.actions.v1')).toBeVisible();
    await captureManualScreenshot(page, '03-support-incident-1440x900.jpg');

    await page.goto(`/mission-control/batches/${batchId}`);
    await expect(page.getByText('Failed Job Details', { exact: true })).toBeVisible();
    const failedJobSupport = page.getByTestId('ion-support-mission-control.failed-job.actions.v1');
    await expect(failedJobSupport).toBeVisible();
    await failedJobSupport.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(100);
    await captureManualScreenshot(page, '04-support-failed-job-1440x900.jpg', { stabilize: false });
  });
});
