// @ts-nocheck
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const defaultSeedFile = path.resolve(process.cwd(), 'test/e2e/.seed/user.json');

export function getE2ESeedData() {
  const env = process.env;
  const seedFile = env.E2E_SEED_FILE || defaultSeedFile;
  if (!existsSync(seedFile)) return {};
  try {
    return JSON.parse(readFileSync(seedFile, 'utf8')) as {
      email?: string;
      password?: string;
      adminEmail?: string;
      adminPassword?: string;
      engineId?: string;
      migrationEngineId?: string;
    };
  } catch {
    return {};
  }
}

export function getE2ECredentials() {
  const env = process.env;
  let email = env.E2E_USER;
  let password = env.E2E_PASSWORD;

  if (!email || !password) {
    const data = getE2ESeedData();
    email = email || data.email;
    password = password || data.password;
  }

  return { email, password };
}

export function getE2EEngineId() {
  return process.env.E2E_ENGINE_ID || getE2ESeedData().engineId;
}

export function getE2EFineGrainedFixture() {
  const data = getE2ESeedData();
  return {
    email: data.scopedEmail,
    password: data.scopedPassword,
    scopedUserId: data.scopedUserId,
    scopedEngineId: data.scopedEngineId,
    scopedEngineName: data.scopedEngineName,
    scopedEngineAssignmentId: data.scopedEngineAssignmentId,
    scopedEngineAssignmentExpiresAt: data.scopedEngineAssignmentExpiresAt,
    siblingEngineId: data.siblingEngineId,
    crossTenantEngineId: data.crossTenantEngineId,
    runtimeScopedEmail: data.runtimeScopedEmail,
    runtimeScopedPassword: data.runtimeScopedPassword,
    runtimeScopedUserId: data.runtimeScopedUserId,
    runtimeScopedEngineId: data.runtimeScopedEngineId,
    runtimeCustomRoleId: data.runtimeCustomRoleId,
    scopeAssignmentRuntimeRoleName: data.scopeAssignmentRuntimeRoleName,
    runtimeAllowedResourceId: data.runtimeAllowedResourceId,
    runtimeAllowedDefinitionId: data.runtimeAllowedDefinitionId,
    runtimeSiblingDefinitionId: data.runtimeSiblingDefinitionId,
    scopeAssignmentEngineSetId: data.scopeAssignmentEngineSetId,
    scopeAssignmentEngineSetKey: data.scopeAssignmentEngineSetKey,
    scopeAssignmentEngineSetName: data.scopeAssignmentEngineSetName,
    scopeAssignmentRuntimeResourceId: data.scopeAssignmentRuntimeResourceId,
    scopeAssignmentRuntimeResourceSetId: data.scopeAssignmentRuntimeResourceSetId,
    scopeAssignmentRuntimeResourceSetKey: data.scopeAssignmentRuntimeResourceSetKey,
    scopeAssignmentRuntimeResourceSetName: data.scopeAssignmentRuntimeResourceSetName,
    scopeAssignmentEngineId: data.scopeAssignmentEngineId,
    scopeAssignmentEngineName: data.scopeAssignmentEngineName,
    scopeAssignmentAllowedDefinitionId: data.scopeAssignmentAllowedDefinitionId,
    scopeAssignmentSiblingDefinitionId: data.scopeAssignmentSiblingDefinitionId,
    scopeAssignmentEngineSetUserId: data.scopeAssignmentEngineSetUserId,
    scopeAssignmentEngineSetEmail: data.scopeAssignmentEngineSetEmail,
    scopeAssignmentEngineSetPassword: data.scopeAssignmentEngineSetPassword,
    scopeAssignmentRuntimeResourceUserId: data.scopeAssignmentRuntimeResourceUserId,
    scopeAssignmentRuntimeResourceEmail: data.scopeAssignmentRuntimeResourceEmail,
    scopeAssignmentRuntimeResourcePassword: data.scopeAssignmentRuntimeResourcePassword,
    scopeAssignmentRuntimeResourceSetUserId: data.scopeAssignmentRuntimeResourceSetUserId,
    scopeAssignmentRuntimeResourceSetEmail: data.scopeAssignmentRuntimeResourceSetEmail,
    scopeAssignmentRuntimeResourceSetPassword: data.scopeAssignmentRuntimeResourceSetPassword,
    groupEmail: data.groupScopedEmail,
    groupPassword: data.groupScopedPassword,
    groupScopedUserId: data.groupScopedUserId,
    groupScopedGroupId: data.groupScopedGroupId,
    groupScopedEngineId: data.groupScopedEngineId,
    groupScopedEngineName: data.groupScopedEngineName,
    groupScopedMembershipId: data.groupScopedMembershipId,
    expiredEmail: data.expiredEmail,
    expiredPassword: data.expiredPassword,
    expiredUserId: data.expiredUserId,
    expiredEngineId: data.expiredEngineId,
    expiredEngineName: data.expiredEngineName,
  };
}

export function getE2EVariableAccessFixture() {
  const data = getE2ESeedData();
  return {
    engineId: data.variableAccessEngineId,
    processInstanceId: data.variableAccessProcessInstanceId,
    deniedProcessInstanceId: data.variableAccessDeniedProcessInstanceId,
    metadataEmail: data.variableMetadataEmail,
    metadataPassword: data.variableMetadataPassword,
    valueEmail: data.variableValueEmail,
    valuePassword: data.variableValuePassword,
    editorEmail: data.variableEditorEmail,
    editorPassword: data.variableEditorPassword,
  };
}

export function hasE2ECredentials() {
  const { email, password } = getE2ECredentials();
  return Boolean(email && password);
}
