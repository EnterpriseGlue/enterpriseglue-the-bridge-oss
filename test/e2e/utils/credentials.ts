// @ts-nocheck
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const defaultSeedFile = path.resolve(process.cwd(), 'test/e2e/.seed/user.json');

export function getE2ESeedData() {
  const env = process.env;
  const seedFile = env.E2E_SEED_FILE || defaultSeedFile;
  if (!existsSync(seedFile)) return {};
  try {
    return JSON.parse(readFileSync(seedFile, 'utf8')) as { email?: string; password?: string; engineId?: string };
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
    scopedEngineId: data.scopedEngineId,
    scopedEngineName: data.scopedEngineName,
    scopedEngineAssignmentId: data.scopedEngineAssignmentId,
    siblingEngineId: data.siblingEngineId,
    crossTenantEngineId: data.crossTenantEngineId,
    runtimeScopedEmail: data.runtimeScopedEmail,
    runtimeScopedPassword: data.runtimeScopedPassword,
    runtimeScopedEngineId: data.runtimeScopedEngineId,
    runtimeCustomRoleId: data.runtimeCustomRoleId,
    runtimeAllowedDefinitionId: data.runtimeAllowedDefinitionId,
    runtimeSiblingDefinitionId: data.runtimeSiblingDefinitionId,
    groupEmail: data.groupScopedEmail,
    groupPassword: data.groupScopedPassword,
    groupScopedEngineId: data.groupScopedEngineId,
    groupScopedEngineName: data.groupScopedEngineName,
    groupScopedMembershipId: data.groupScopedMembershipId,
    expiredEmail: data.expiredEmail,
    expiredPassword: data.expiredPassword,
    expiredEngineId: data.expiredEngineId,
  };
}

export function hasE2ECredentials() {
  const { email, password } = getE2ECredentials();
  return Boolean(email && password);
}
