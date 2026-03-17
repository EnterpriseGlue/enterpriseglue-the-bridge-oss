import { test, expect, type Page, type Route } from '@playwright/test';
import { getE2ECredentials, hasE2ECredentials } from '../utils/credentials';

const shouldSkip = !hasE2ECredentials();
const projectId = '11111111-1111-1111-8111-111111111111';
const primaryFileId = '22222222-2222-2222-8222-222222222222';
const primaryFileName = 'Invoice';
const secondaryFileId = '33333333-3333-3333-8333-333333333333';
const secondaryFileName = 'Quote';

const BPMN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="approval-process" isExecutable="true">
    <bpmn:startEvent id="start" name="Start" />
    <bpmn:sequenceFlow id="flow-1" sourceRef="start" targetRef="approveTask" />
    <bpmn:userTask id="approveTask" name="Approve Invoice" />
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
const SECONDARY_BPMN_XML = BPMN_XML.split('approval-process').join('quote-process').split('Approve Invoice').join('Review Quote');
const VERSION_ONE_BPMN_XML = BPMN_XML.replace('Approve Invoice', 'Approve Invoice v1');
const VERSION_TWO_BPMN_XML = BPMN_XML.replace('Approve Invoice', 'Approve Invoice v2');

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function login(page: Page) {
  const { email, password } = getE2ECredentials();
  if (!email || !password) throw new Error('Missing E2E credentials');
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

type VersioningStubState = {
  fileUpdateBodies: Array<Record<string, unknown>>;
  localSaveBodies: Array<Record<string, unknown>>;
  gitCommitBodies: Array<Record<string, unknown>>;
  getLocalRestoreVersionIds: () => string[];
  getGitRestoreCommitIds: () => string[];
  getLocalVersionMessages: (fileId: string) => string[];
  getGitCommitMessages: (fileId: string) => string[];
  getOfflineUncommittedCalls: () => number;
  getLocalVersionsReadCalls: () => number;
  getGitCommitsReadCalls: () => number;
};

type StubGitCommit = {
  id: string;
  projectId: string;
  branchId: string;
  userId: string;
  message: string;
  hash: string;
  createdAt: number;
  source: string;
  isRemote: boolean;
  versionNumber?: number;
  fileVersionNumber?: number;
};

async function stubEditorVersioning(page: Page, mode: 'offline' | 'git'): Promise<VersioningStubState> {
  let updatedAt = 1700000000000;
  const fileUpdateBodies: Array<Record<string, unknown>> = [];
  const localSaveBodies: Array<Record<string, unknown>> = [];
  const gitCommitBodies: Array<Record<string, unknown>> = [];
  const localRestoreVersionIds: string[] = [];
  const gitRestoreCommitIds: string[] = [];
  let offlineUncommittedCalls = 0;
  let localVersionsReadCalls = 0;
  let gitCommitsReadCalls = 0;
  const localVersionsByFileId = new Map<string, Array<{
    id: string;
    author: string;
    message: string;
    createdAt: number;
    xml: string;
  }>>();
  localVersionsByFileId.set(primaryFileId, [
    {
      id: 'initial-import',
      author: 'system',
      message: 'Initial import',
      createdAt: 1700000000,
      xml: BPMN_XML,
    },
    {
      id: 'local-version-1',
      author: 'user-1',
      message: 'Draft v1',
      createdAt: 1700000001,
      xml: VERSION_ONE_BPMN_XML,
    },
    {
      id: 'local-version-2',
      author: 'user-1',
      message: 'Draft v2',
      createdAt: 1700000002,
      xml: VERSION_TWO_BPMN_XML,
    },
  ]);
  localVersionsByFileId.set(secondaryFileId, [
    {
      id: 'initial-import',
      author: 'system',
      message: 'Initial import',
      createdAt: 1700000000,
      xml: SECONDARY_BPMN_XML,
    },
  ]);

  const files: Array<{
    id: string;
    name: string;
    type: 'bpmn';
    bpmnProcessId: string;
    xml: string;
  }> = [
    {
      id: primaryFileId,
      name: primaryFileName,
      type: 'bpmn',
      bpmnProcessId: 'approval-process',
      xml: BPMN_XML,
    },
    {
      id: secondaryFileId,
      name: secondaryFileName,
      type: 'bpmn',
      bpmnProcessId: 'quote-process',
      xml: SECONDARY_BPMN_XML,
    },
  ];

  const fileById = new Map(files.map((file) => [file.id, file]));
  const gitCommitsByFileId = new Map<string, StubGitCommit[]>();
  const gitCommitXmlById = new Map<string, string>();

  const registerGitCommit = (requestedFileId: string, commit: StubGitCommit, xml: string) => {
    const existing = gitCommitsByFileId.get(requestedFileId) || [];
    gitCommitsByFileId.set(requestedFileId, [commit, ...existing]);
    gitCommitXmlById.set(commit.id, xml);
  };

  registerGitCommit(primaryFileId, {
    id: 'commit-system',
    projectId,
    branchId: 'main-branch-1',
    userId: 'user-1',
    message: 'Nightly baseline',
    hash: 'hash-system',
    createdAt: 1700000001000,
    source: 'system',
    isRemote: true,
  }, VERSION_TWO_BPMN_XML);
  registerGitCommit(primaryFileId, {
    id: 'commit-legacy',
    projectId,
    branchId: 'main-branch-1',
    userId: 'user-1',
    message: 'Legacy version',
    hash: 'hash-legacy',
    createdAt: 1700000000000,
    source: 'manual',
    isRemote: true,
    versionNumber: 1,
  }, VERSION_ONE_BPMN_XML);
  registerGitCommit(secondaryFileId, {
    id: 'commit-system-secondary',
    projectId,
    branchId: 'main-branch-1',
    userId: 'user-1',
    message: 'Nightly baseline',
    hash: 'hash-system-secondary',
    createdAt: 1700000001000,
    source: 'system',
    isRemote: true,
  }, SECONDARY_BPMN_XML);
  registerGitCommit(secondaryFileId, {
    id: 'commit-legacy-secondary',
    projectId,
    branchId: 'main-branch-1',
    userId: 'user-1',
    message: 'Legacy version',
    hash: 'hash-legacy-secondary',
    createdAt: 1700000000000,
    source: 'manual',
    isRemote: true,
    versionNumber: 1,
  }, SECONDARY_BPMN_XML);

  await page.route('**/api/auth/platform-settings', async (route) => {
    await fulfillJson(route, {
      syncPushEnabled: true,
      syncPullEnabled: false,
      gitProjectTokenSharingEnabled: false,
      defaultDeployRoles: ['owner', 'delegate', 'developer'],
    });
  });

  await page.route(/.*\/starbase-api\/files\/[^/?]+(?:\?.*)?$/, async (route) => {
    const requestUrl = new URL(route.request().url());
    const requestedFileId = requestUrl.pathname.split('/').pop() || '';
    const file = fileById.get(requestedFileId);
    if (!file) {
      await fulfillJson(route, { message: 'Not found' }, 404);
      return;
    }

    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      fileUpdateBodies.push(body);
      if (typeof body.xml === 'string') {
        file.xml = body.xml;
      }
      updatedAt += 1000;
      await fulfillJson(route, { updatedAt });
      return;
    }

    await fulfillJson(route, {
      id: file.id,
      projectId,
      projectName: 'E2E Versioning Project',
      folderId: null,
      folderBreadcrumb: [],
      name: file.name,
      type: file.type,
      xml: file.xml,
      createdAt: 1699999999000,
      updatedAt,
    });
  });

  await page.route(`**/starbase-api/projects/${projectId}/files`, async (route) => {
    await fulfillJson(route, files.map((file) => ({
      id: file.id,
      name: file.name,
      type: file.type,
      folderId: null,
      bpmnProcessId: file.bpmnProcessId,
    })));
  });

  await page.route(`**/starbase-api/projects/${projectId}/members/me`, async (route) => {
    await fulfillJson(route, {
      userId: 'user-1',
      role: 'editor',
      roles: ['editor'],
      deployAllowed: false,
    });
  });

  await page.route(`**/starbase-api/projects/${projectId}/engine-access`, async (route) => {
    await fulfillJson(route, {
      accessedEngines: [],
      pendingRequests: [],
      availableEngines: [],
    });
  });

  await page.route(`**/starbase-api/projects/${projectId}/engine-deployments/latest`, async (route) => {
    await fulfillJson(route, []);
  });

  await page.route('**/engines-api/engines**', async (route) => {
    await fulfillJson(route, []);
  });

  await page.route('**/git-api/repositories**', async (route) => {
    if (mode === 'git') {
      await fulfillJson(route, [
        {
          id: 'repo-1',
          projectId,
          name: 'versioning-repo',
          fullName: 'e2e/versioning-repo',
          providerId: 'provider-1',
          defaultBranch: 'main',
          url: 'https://example.com/e2e/versioning-repo.git',
        },
      ]);
      return;
    }

    await fulfillJson(route, []);
  });

  await page.route(/.*\/starbase-api\/files\/[^/?]+\/versions(?:\?.*)?$/, async (route) => {
    const requestUrl = new URL(route.request().url());
    const parts = requestUrl.pathname.split('/');
    const requestedFileId = parts[parts.length - 2] || '';
    if (!fileById.has(requestedFileId)) {
      await fulfillJson(route, { message: 'Not found' }, 404);
      return;
    }

    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      localSaveBodies.push(body);
      const existing = localVersionsByFileId.get(requestedFileId) || [];
      const nextVersion = {
        id: `local-version-${existing.length}`,
        author: 'user-1',
        message: String(body.message || ''),
        createdAt: 1700000000 + existing.length,
        xml: fileById.get(requestedFileId)?.xml || BPMN_XML,
      };
      localVersionsByFileId.set(requestedFileId, [...existing, nextVersion]);
      await fulfillJson(route, {
        id: nextVersion.id,
        author: 'user-1',
        message: body.message,
        createdAt: nextVersion.createdAt,
      }, 201);
      return;
    }

    localVersionsReadCalls += 1;
    const versions = (localVersionsByFileId.get(requestedFileId) || []).map(({ id, author, message, createdAt }) => ({
      id,
      author,
      message,
      createdAt,
    }));

    await fulfillJson(route, versions);
  });

  await page.route(/.*\/starbase-api\/files\/[^/?]+\/versions\/[^/?]+(?:\/restore)?(?:\?.*)?$/, async (route) => {
    const requestUrl = new URL(route.request().url());
    const parts = requestUrl.pathname.split('/');
    const versionsIndex = parts.lastIndexOf('versions');
    const requestedFileId = versionsIndex > 0 ? (parts[versionsIndex - 1] || '') : '';
    const versionId = versionsIndex >= 0 ? (parts[versionsIndex + 1] || '') : '';
    const versions = localVersionsByFileId.get(requestedFileId) || [];
    const version = versions.find((entry) => entry.id === versionId);
    if (!version) {
      await fulfillJson(route, { message: 'Not found' }, 404);
      return;
    }

    if (route.request().method() === 'POST') {
      localRestoreVersionIds.push(versionId);
      const file = fileById.get(requestedFileId);
      if (file) {
        file.xml = version.xml;
      }
      const restoredEntry = {
        id: `local-version-${versions.length}`,
        author: 'user-1',
        message: `Restored from ${version.message}`,
        createdAt: 1700000000 + versions.length,
        xml: version.xml,
      };
      localVersionsByFileId.set(requestedFileId, [...versions, restoredEntry]);
      updatedAt += 1000;
      await fulfillJson(route, {
        restored: true,
        fileId: requestedFileId,
        versionId,
        updatedAt,
      });
      return;
    }

    await fulfillJson(route, {
      id: version.id,
      fileId: requestedFileId,
      author: version.author,
      message: version.message,
      xml: version.xml,
      createdAt: version.createdAt,
    });
  });

  await page.route(`**/vcs-api/projects/${projectId}/uncommitted-files**`, async (route) => {
    if (mode === 'offline') {
      offlineUncommittedCalls += 1;
      await fulfillJson(route, {
        hasUncommittedChanges: false,
        uncommittedFileIds: [],
      });
      return;
    }

    await fulfillJson(route, {
      hasUncommittedChanges: gitCommitBodies.length === 0,
      uncommittedFileIds: gitCommitBodies.length === 0 ? [primaryFileId] : [],
    });
  });

  await page.route(`**/vcs-api/projects/${projectId}/commits**`, async (route) => {
    gitCommitsReadCalls += 1;
    const requestUrl = new URL(route.request().url());
    const requestedFileId = requestUrl.searchParams.get('fileId');
    if (mode === 'offline') {
      await fulfillJson(route, { commits: [] });
      return;
    }

    await fulfillJson(route, { commits: gitCommitsByFileId.get(requestedFileId || '') || [] });
  });

  await page.route(`**/vcs-api/projects/${projectId}/commit`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    gitCommitBodies.push(body);
    const targetFileIds = Array.isArray(body.fileIds) && body.fileIds.length > 0
      ? body.fileIds.map((id) => String(id))
      : files.map((file) => file.id);
    const commitId = `commit-new-${gitCommitBodies.length}`;
    for (const requestedFileId of targetFileIds) {
      const file = fileById.get(requestedFileId);
      if (!file) continue;
      const existing = gitCommitsByFileId.get(requestedFileId) || [];
      const nextVersionNumber = existing.reduce((max, commit) => Math.max(max, Number(commit.fileVersionNumber || commit.versionNumber || 0)), 0) + 1;
      registerGitCommit(requestedFileId, {
        id: commitId,
        projectId,
        branchId: 'draft-branch-1',
        userId: 'user-1',
        message: String(body.message || 'Git save'),
        hash: `hash-new-${gitCommitBodies.length}`,
        createdAt: 1700000003000 + gitCommitBodies.length,
        source: 'file-save',
        isRemote: false,
        fileVersionNumber: nextVersionNumber,
      }, file.xml);
    }
    await fulfillJson(route, {
      commitId,
      message: body.message,
      fileCount: 1,
    });
  });

  await page.route(`**/vcs-api/projects/${projectId}/commits/*/files`, async (route) => {
    const requestUrl = new URL(route.request().url());
    const parts = requestUrl.pathname.split('/');
    const commitId = parts[parts.length - 2] === 'commits' ? '' : (parts[parts.length - 1] === 'files' ? parts[parts.length - 2] : '');
    const xml = gitCommitXmlById.get(commitId);
    await fulfillJson(route, {
      files: xml ? [{
        id: primaryFileId,
        name: primaryFileName,
        type: 'bpmn',
        content: xml,
        changeType: 'modified',
      }] : [],
    });
  });

  await page.route(`**/vcs-api/projects/${projectId}/commits/*/restore`, async (route) => {
    const requestUrl = new URL(route.request().url());
    const parts = requestUrl.pathname.split('/');
    const commitId = parts[parts.length - 1] === 'restore' ? parts[parts.length - 2] || '' : '';
    gitRestoreCommitIds.push(commitId);
    const xml = gitCommitXmlById.get(commitId);
    const file = fileById.get(primaryFileId);
    if (xml && file) {
      file.xml = xml;
    }
    const existing = gitCommitsByFileId.get(primaryFileId) || [];
    const nextVersionNumber = existing.reduce((max, commit) => Math.max(max, Number(commit.fileVersionNumber || commit.versionNumber || 0)), 0) + 1;
    const restoreCommitId = `commit-restore-${gitRestoreCommitIds.length}`;
    registerGitCommit(primaryFileId, {
      id: restoreCommitId,
      projectId,
      branchId: 'draft-branch-1',
      userId: 'user-1',
      message: `Restored from checkpoint ${commitId.substring(0, 8)}`,
      hash: `hash-restore-${gitRestoreCommitIds.length}`,
      createdAt: 1700000004000 + gitRestoreCommitIds.length,
      source: 'restore',
      isRemote: false,
      fileVersionNumber: nextVersionNumber,
    }, xml || BPMN_XML);
    await fulfillJson(route, {
      success: true,
      filesRestored: 1,
      newCommitId: restoreCommitId,
    });
  });

  return {
    fileUpdateBodies,
    localSaveBodies,
    gitCommitBodies,
    getLocalRestoreVersionIds: () => [...localRestoreVersionIds],
    getGitRestoreCommitIds: () => [...gitRestoreCommitIds],
    getLocalVersionMessages: (requestedFileId: string) => (localVersionsByFileId.get(requestedFileId) || []).map((entry) => entry.message),
    getGitCommitMessages: (requestedFileId: string) => (gitCommitsByFileId.get(requestedFileId) || []).map((entry) => entry.message),
    getOfflineUncommittedCalls: () => offlineUncommittedCalls,
    getLocalVersionsReadCalls: () => localVersionsReadCalls,
    getGitCommitsReadCalls: () => gitCommitsReadCalls,
  };
}

test.describe('Smoke: Starbase versioning split', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set');

  test('offline projects save versions via local file versions API @smoke', async ({ page }) => {
    await login(page);
    const state = await stubEditorVersioning(page, 'offline');

    await page.goto(`/starbase/editor/${primaryFileId}`);
    await expect(page.getByRole('button', { name: 'Versions' })).toBeVisible();

    await page.getByRole('button', { name: 'Versions' }).click();

    await page.getByRole('button', { name: /new version|save version/i }).click();
    await expect(page.getByRole('dialog', { name: /create version/i })).toBeVisible();
    await page.getByRole('dialog', { name: /create version/i }).getByLabel(/version description/i).fill('Offline save');
    await page.getByRole('dialog', { name: /create version/i }).getByRole('button', { name: 'Create' }).click();

    await expect.poll(() => `${state.localSaveBodies.length}/${state.gitCommitBodies.length}`).toBe('1/0');
    await expect(page.getByRole('dialog', { name: /create version/i })).not.toBeVisible();
    expect(state.fileUpdateBodies.length).toBeGreaterThan(0);
    expect(state.localSaveBodies).toEqual([{ message: 'Offline save' }]);
    expect(state.gitCommitBodies).toHaveLength(0);
    expect(state.getOfflineUncommittedCalls()).toBe(0);
    expect(state.getLocalVersionsReadCalls()).toBeGreaterThan(0);
    expect(state.getGitCommitsReadCalls()).toBe(0);
  });

  test('git-connected projects save versions via VCS commit API @smoke', async ({ page }) => {
    await login(page);
    const state = await stubEditorVersioning(page, 'git');

    await page.goto(`/starbase/editor/${primaryFileId}`);
    await expect(page.getByRole('button', { name: 'Versions' })).toBeVisible();

    await page.getByRole('button', { name: 'Versions' }).click();
    await expect(page.getByText(/Legacy version/i)).toBeVisible();
    await expect(page.getByText(/Nightly baseline/i)).not.toBeVisible();

    await page.getByRole('button', { name: /new version|save version/i }).click();
    await expect(page.getByRole('dialog', { name: /create version/i })).toBeVisible();
    await page.getByRole('dialog', { name: /create version/i }).getByLabel(/version description/i).fill('Git save');
    await page.getByRole('dialog', { name: /create version/i }).getByRole('button', { name: 'Create' }).click();

    await expect.poll(() => state.gitCommitBodies.length).toBe(1);
    await expect(page.getByRole('dialog', { name: /create version/i })).not.toBeVisible();
    expect(state.fileUpdateBodies.length).toBeGreaterThan(0);
    expect(state.gitCommitBodies).toEqual([{ message: 'Git save', fileIds: [primaryFileId] }]);
    expect(state.localSaveBodies).toHaveLength(0);
  });

  test('offline version save in fileA does not appear in fileB @smoke', async ({ page }) => {
    await login(page);
    const state = await stubEditorVersioning(page, 'offline');

    await page.goto(`/starbase/editor/${primaryFileId}`);
    await page.getByRole('button', { name: 'Versions' }).click();
    await page.getByRole('button', { name: /new version|save version/i }).click();
    await expect(page.getByRole('dialog', { name: /create version/i })).toBeVisible();
    await page.getByRole('dialog', { name: /create version/i }).getByLabel(/version description/i).fill('Offline fileA only');
    await page.getByRole('dialog', { name: /create version/i }).getByRole('button', { name: 'Create' }).click();
    await expect.poll(() => state.localSaveBodies.length).toBe(1);

    await page.goto(`/starbase/editor/${secondaryFileId}`);
    await expect(page.getByRole('button', { name: 'Versions' })).toBeVisible();
    await page.getByRole('button', { name: 'Versions' }).click();

    await expect(page.getByText(/No versions yet\. Save a version to start tracking changes\./i)).toBeVisible();
    await expect(page.getByText(/Offline fileA only/i)).not.toBeVisible();
    expect(state.gitCommitBodies).toHaveLength(0);
  });

  test('git version save in fileA does not appear in fileB history @smoke', async ({ page }) => {
    await login(page);
    const state = await stubEditorVersioning(page, 'git');

    await page.goto(`/starbase/editor/${primaryFileId}`);
    await page.getByRole('button', { name: 'Versions' }).click();
    await page.getByRole('button', { name: /new version|save version/i }).click();
    await expect(page.getByRole('dialog', { name: /create version/i })).toBeVisible();
    await page.getByRole('dialog', { name: /create version/i }).getByLabel(/version description/i).fill('Git fileA only');
    await page.getByRole('dialog', { name: /create version/i }).getByRole('button', { name: 'Create' }).click();
    await expect.poll(() => state.gitCommitBodies.length).toBe(1);

    await page.goto(`/starbase/editor/${secondaryFileId}`);
    await expect(page.getByRole('button', { name: 'Versions' })).toBeVisible();
    await page.getByRole('button', { name: 'Versions' }).click();

    await expect(page.getByText(/Legacy version/i)).toBeVisible();
    await expect(page.getByText(/Git fileA only/i)).not.toBeVisible();
    expect(state.gitCommitBodies).toEqual([{ message: 'Git fileA only', fileIds: [primaryFileId] }]);
  });

  test('offline restore auto-saves unsaved draft before creating restored version @smoke', async ({ page }) => {
    await login(page);
    const state = await stubEditorVersioning(page, 'offline');

    await page.goto(`/starbase/editor/${primaryFileId}`);
    await expect(page.getByRole('button', { name: 'Versions' })).toBeVisible();
    await page.evaluate((id) => {
      window.sessionStorage.setItem(`starbase:lastEditedAt:${id}`, String(Date.now()));
    }, primaryFileId);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Versions' })).toBeVisible();
    await page.getByRole('button', { name: 'Versions' }).click();

    await expect(page.getByText(/Unsaved version/i)).toBeVisible();
    await expect(page.getByText(/Draft v2/i)).toBeVisible();
    await expect(page.getByText(/Draft v1/i)).toBeVisible();

    await page.getByRole('button', { name: /Draft v1/i }).click();
    await expect(page.getByRole('heading', { name: /Version: Draft v1/i })).toBeVisible();
    await page.getByRole('button', { name: /restore this version/i }).click();

    await expect.poll(() => state.getLocalRestoreVersionIds()).toEqual(['local-version-1']);
    await expect.poll(() => state.localSaveBodies).toEqual([{ message: 'Auto-saved before restore' }]);
    await expect.poll(() => state.getLocalVersionMessages(primaryFileId)).toContain('Auto-saved before restore');
    await expect.poll(() => state.getLocalVersionMessages(primaryFileId).some((message) => /Restored from Draft v1/i.test(message))).toBe(true);
    await expect(page.getByRole('button', { name: 'Versions' })).toBeVisible();

    await page.getByRole('button', { name: 'Versions' }).click();
    await expect(page.getByText(/Unsaved version/i)).not.toBeVisible();
    await expect(page.getByText(/Auto-saved before restore/i)).toBeVisible();
    await expect(page.getByText(/Restored from Draft v1/i)).toBeVisible();
  });

  test('git restore auto-saves unsaved draft before creating restore commit @smoke', async ({ page }) => {
    await login(page);
    const state = await stubEditorVersioning(page, 'git');

    await page.goto(`/starbase/editor/${primaryFileId}`);
    await expect(page.getByRole('button', { name: 'Versions' })).toBeVisible();
    await page.evaluate((id) => {
      window.sessionStorage.setItem(`starbase:lastEditedAt:${id}`, String(Date.now()));
    }, primaryFileId);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Versions' })).toBeVisible();
    await page.getByRole('button', { name: 'Versions' }).click();

    await expect(page.getByText(/Unsaved version/i)).toBeVisible();
    await expect(page.getByText(/Legacy version/i)).toBeVisible();

    await page.getByRole('button', { name: /Legacy version/i }).click();
    await expect(page.getByRole('heading', { name: /Version: Legacy version/i })).toBeVisible();
    await page.getByRole('button', { name: /restore this version/i }).click();

    await expect.poll(() => state.gitCommitBodies).toEqual([{ message: 'Auto-saved before restore', fileIds: [primaryFileId] }]);
    await expect.poll(() => state.getGitRestoreCommitIds()).toEqual(['commit-legacy']);
    await expect.poll(() => state.getGitCommitMessages(primaryFileId)).toContain('Auto-saved before restore');
    await expect.poll(() => state.getGitCommitMessages(primaryFileId).some((message) => /Restored from checkpoint commit-l/i.test(message))).toBe(true);

    await expect(page.getByRole('button', { name: 'Versions' })).toBeVisible();
    await page.getByRole('button', { name: 'Versions' }).click();
    await expect(page.getByText(/Unsaved version/i)).not.toBeVisible();
    await expect(page.getByText(/Auto-saved before restore/i)).toBeVisible();
    await expect(page.getByText(/Restored from checkpoint/i)).toBeVisible();
  });

  test('offline unsaved draft state stays visible after reload @smoke', async ({ page }) => {
    await login(page);
    await stubEditorVersioning(page, 'offline');

    await page.goto(`/starbase/editor/${primaryFileId}`);
    await expect(page.getByRole('button', { name: 'Versions' })).toBeVisible();

    await page.evaluate((id) => {
      window.sessionStorage.setItem(`starbase:lastEditedAt:${id}`, String(Date.now()));
    }, primaryFileId);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Versions' })).toBeVisible();
    await page.getByRole('button', { name: 'Versions' }).click();

    await expect(page.getByText(/Unsaved version/i)).toBeVisible();
    await expect(page.getByText(/Draft v2/i)).toBeVisible();
  });
});
