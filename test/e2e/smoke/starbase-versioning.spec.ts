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
  createdFileBodies: Array<Record<string, unknown>>;
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
  const createdFileBodies: Array<Record<string, unknown>> = [];
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

  const currentUserId = await page.evaluate(() => {
    try {
      const stored = window.localStorage.getItem('user');
      const parsed = stored ? JSON.parse(stored) : null;
      return typeof parsed?.id === 'string' ? parsed.id : 'user-1';
    } catch {
      return 'user-1';
    }
  });
  const ownedLocksByFileId = new Map<string, CollaborationRouteLock>([
    [
      primaryFileId,
      {
        id: 'lock-primary-owner',
        fileId: primaryFileId,
        userId: currentUserId,
        userName: 'Owner User',
        acquiredAt: updatedAt,
        lastInteractionAt: updatedAt,
        expiresAt: updatedAt + 45_000,
        heartbeatAt: updatedAt,
        visibilityState: 'visible',
        visibilityChangedAt: updatedAt,
        sessionStatus: 'active',
      },
    ],
  ]);

  await page.route(/.*\/git-api\/locks\/[^/?]+\/heartbeat(?:\?.*)?$/, async (route) => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const lockId = parts[parts.length - 2] || '';
    const currentLock = [...ownedLocksByFileId.values()].find((lock) => lock.id === lockId) || null;
    if (!currentLock) {
      await fulfillJson(route, { message: 'Lock not found' }, 404);
      return;
    }
    const nextLock = {
      ...currentLock,
      heartbeatAt: Date.now(),
      lastInteractionAt: Date.now(),
      expiresAt: Date.now() + 45_000,
      sessionStatus: 'active' as const,
    };
    ownedLocksByFileId.set(currentLock.fileId, nextLock);
    await fulfillJson(route, { success: true, lock: nextLock });
  });

  await page.route(/.*\/git-api\/locks\/[^/?]+(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== 'DELETE') {
      await fulfillJson(route, { message: 'Not found' }, 404);
      return;
    }
    const parts = new URL(route.request().url()).pathname.split('/');
    const lockId = parts[parts.length - 1] || '';
    for (const [fileId, lock] of ownedLocksByFileId.entries()) {
      if (lock.id === lockId) {
        ownedLocksByFileId.delete(fileId);
      }
    }
    await fulfillJson(route, { success: true });
  });

  await page.route(/.*\/git-api\/locks(?:\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, { locks: [...ownedLocksByFileId.values()] });
      return;
    }

    if (route.request().method() === 'POST') {
      const body = (route.request().postDataJSON() as Record<string, unknown>) || {};
      const requestedFileId = String(body.fileId || '');
      const nextLock: CollaborationRouteLock = {
        id: `lock-${requestedFileId || 'file'}-owner`,
        fileId: requestedFileId,
        userId: currentUserId,
        userName: 'Owner User',
        acquiredAt: Date.now(),
        lastInteractionAt: Date.now(),
        expiresAt: Date.now() + 45_000,
        heartbeatAt: Date.now(),
        visibilityState: 'visible',
        visibilityChangedAt: Date.now(),
        sessionStatus: 'active',
      };
      ownedLocksByFileId.set(requestedFileId, nextLock);
      await fulfillJson(route, nextLock, 201);
      return;
    }

    await fulfillJson(route, { message: 'Method not allowed' }, 405);
  });

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
    if (route.request().method() === 'POST') {
      const body = (route.request().postDataJSON() as Record<string, unknown>) || {};
      createdFileBodies.push(body);
      const nextId = `created-file-${createdFileBodies.length}`;
      const createdFile = {
        id: nextId,
        name: String(body.name || `Recovered copy ${createdFileBodies.length}`),
        type: 'bpmn' as const,
        bpmnProcessId: `created-process-${createdFileBodies.length}`,
        xml: typeof body.xml === 'string' ? body.xml : BPMN_XML,
      };
      files.push(createdFile);
      fileById.set(createdFile.id, createdFile);
      await fulfillJson(route, {
        id: createdFile.id,
        name: createdFile.name,
        type: createdFile.type,
        bpmnProcessId: createdFile.bpmnProcessId,
        createdAt: updatedAt + createdFileBodies.length,
        updatedAt: updatedAt + createdFileBodies.length,
      }, 201);
      return;
    }
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
    createdFileBodies,
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

type CollaborationLockStatus = 'active' | 'idle' | 'hidden';

type CollaborationRouteLock = {
  id: string;
  fileId: string;
  userId: string;
  userName: string;
  acquiredAt: number;
  lastInteractionAt: number;
  expiresAt: number;
  heartbeatAt: number;
  visibilityState: 'visible' | 'hidden';
  visibilityChangedAt: number;
  sessionStatus: CollaborationLockStatus;
};

function toLockHolder(lock: CollaborationRouteLock) {
  return {
    userId: lock.userId,
    name: lock.userName,
    acquiredAt: lock.acquiredAt,
    heartbeatAt: lock.heartbeatAt,
    lastInteractionAt: lock.lastInteractionAt,
    visibilityState: lock.visibilityState,
    visibilityChangedAt: lock.visibilityChangedAt,
    sessionStatus: lock.sessionStatus,
  };
}

async function stubEditorCollaboration(page: Page, sessionStatus: CollaborationLockStatus) {
  const versioning = await stubEditorVersioning(page, 'git');

  const acquireBodies: Array<Record<string, unknown>> = [];
  const heartbeatBodies: Array<Record<string, unknown>> = [];
  const now = 1700000005000;
  const currentUserId = await page.evaluate(() => {
    try {
      const stored = window.localStorage.getItem('user');
      const parsed = stored ? JSON.parse(stored) : null;
      return typeof parsed?.id === 'string' ? parsed.id : 'user-1';
    } catch {
      return 'user-1';
    }
  });
  const competingUserId = currentUserId === 'user-2' ? 'user-2-other' : 'user-2';
  const ownerLock: CollaborationRouteLock = {
    id: 'lock-owner',
    fileId: primaryFileId,
    userId: currentUserId,
    userName: 'Owner User',
    acquiredAt: now,
    lastInteractionAt: now,
    expiresAt: now + 45_000,
    heartbeatAt: now,
    visibilityState: 'visible' as const,
    visibilityChangedAt: now,
    sessionStatus: 'active' as const,
  };
  const otherUserLockBase: CollaborationRouteLock = {
    id: 'lock-other',
    fileId: primaryFileId,
    userId: competingUserId,
    userName: 'Alex Editor',
    acquiredAt: now - 20_000,
    lastInteractionAt: sessionStatus === 'idle' ? now - 180_000 : now - 5_000,
    expiresAt: now + 45_000,
    heartbeatAt: now - 2_000,
    visibilityState: sessionStatus === 'hidden' ? 'hidden' : 'visible',
    visibilityChangedAt: sessionStatus === 'hidden' ? now - 40_000 : now - 2_000,
    sessionStatus,
  };
  let currentLock: CollaborationRouteLock | null = otherUserLockBase;

  await page.route(/.*\/git-api\/locks\/[^/?]+\/heartbeat(?:\?.*)?$/, async (route) => {
    heartbeatBodies.push((route.request().postDataJSON() as Record<string, unknown>) || {});
    await fulfillJson(route, { success: true, lock: ownerLock });
  });

  await page.route(/.*\/git-api\/locks\/[^/?]+(?:\?.*)?$/, async (route) => {
    if (route.request().method() === 'DELETE') {
      currentLock = null;
      await fulfillJson(route, { success: true });
      return;
    }
    await fulfillJson(route, { message: 'Not found' }, 404);
  });

  await page.route(/.*\/git-api\/locks(?:\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, { locks: currentLock ? [currentLock] : [] });
      return;
    }

    if (route.request().method() === 'POST') {
      const body = (route.request().postDataJSON() as Record<string, unknown>) || {};
      acquireBodies.push(body);
      if (body.force === true) {
        currentLock = ownerLock;
        await fulfillJson(route, ownerLock, 201);
        return;
      }
      await fulfillJson(route, {
        error: 'File is locked by another user',
        lockHolder: currentLock ? toLockHolder(currentLock) : null,
      }, 409);
      return;
    }

    await fulfillJson(route, { message: 'Method not allowed' }, 405);
  });

  return {
    ...versioning,
    acquireBodies,
    heartbeatBodies,
    currentUserId,
    getCurrentLock: () => currentLock,
    supersedeByOtherUser: () => {
      currentLock = {
        ...otherUserLockBase,
        acquiredAt: Date.now(),
        lastInteractionAt: Date.now(),
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 45_000,
        visibilityChangedAt: Date.now(),
        sessionStatus: 'active',
      };
    },
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

  test('active collaboration lock shows takeover modal and force takeover works @smoke', async ({ page }) => {
    await login(page);
    const collaboration = await stubEditorCollaboration(page, 'active');

    await page.goto(`/starbase/editor/${primaryFileId}`);
    await expect(page.getByRole('heading', { name: /take over editing\?/i })).toBeVisible();
    await expect(page.getByRole('status').getByText(/Alex Editor is actively editing this draft/i)).toBeVisible();

    await page.getByRole('button', { name: /^Take over$/i }).click();

    await expect.poll(() => collaboration.acquireBodies.filter((body) => body.force === true).length).toBe(1);
    expect(collaboration.acquireBodies[collaboration.acquireBodies.length - 1]).toMatchObject({ fileId: primaryFileId, force: true });
    await expect(page.getByRole('heading', { name: /take over editing\?/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Versions' })).toBeEnabled();
    expect(collaboration.getCurrentLock()?.userId).toBe(collaboration.currentUserId);
  });

  test('idle collaboration lock stays read-only until explicit takeover @smoke', async ({ page }) => {
    await login(page);
    const collaboration = await stubEditorCollaboration(page, 'idle');

    await page.goto(`/starbase/editor/${primaryFileId}`);
    await expect(page.getByRole('status').getByText(/Alex Editor appears idle/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: /take over editing\?/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Versions' })).toBeDisabled();

    await page.getByRole('button', { name: /take over editing/i }).first().click();

    await expect.poll(() => collaboration.acquireBodies.filter((body) => body.force === true).length).toBe(1);
    expect(collaboration.acquireBodies[collaboration.acquireBodies.length - 1]).toMatchObject({ fileId: primaryFileId, force: true });
    await expect(page.getByRole('button', { name: 'Versions' })).toBeEnabled();
  });
});
