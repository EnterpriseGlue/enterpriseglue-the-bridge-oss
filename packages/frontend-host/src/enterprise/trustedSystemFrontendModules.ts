import type {
  TrustedSystemFrontendModuleDescriptorV1,
  TrustedSystemFrontendModuleV1,
} from '@enterpriseglue/enterprise-plugin-api/frontend';

import {
  createFrontendPluginContext,
  registerFrontendPlugin,
} from './loadEnterpriseFrontendPlugin';

export const SYSTEM_MODULE_REGISTRATION_GLOBAL =
  '__ENTERPRISEGLUE_REGISTER_SYSTEM_FRONTEND_MODULE_V1__';

type ModuleLoader = (
  descriptor: TrustedSystemFrontendModuleDescriptorV1,
) => Promise<TrustedSystemFrontendModuleV1>;

export async function loadTrustedSystemFrontendModules(
  descriptors: readonly TrustedSystemFrontendModuleDescriptorV1[],
  loader: ModuleLoader = loadModuleScript,
): Promise<{ activeOwnerIds: string[]; failures: Array<{ ownerId: string; code: string }> }> {
  const validated = validateTrustedSystemModuleDescriptors(descriptors);
  const activeOwnerIds: string[] = [];
  const failures: Array<{ ownerId: string; code: string }> = [];
  for (const descriptor of validated) {
    try {
      const module = await loader(descriptor);
      if (module.ownerId !== descriptor.ownerId || typeof module.activate !== 'function') {
        throw new Error('system_module_invalid');
      }
      const plugin = await module.activate(createFrontendPluginContext());
      registerFrontendPlugin(descriptor.ownerId, plugin, false);
      activeOwnerIds.push(descriptor.ownerId);
    } catch {
      failures.push({ ownerId: descriptor.ownerId, code: 'activation_failed' });
      if (descriptor.required) throw new Error(`Required system frontend module ${descriptor.ownerId} could not be activated`);
      console.error(`[Enterprise] Optional system frontend module ${descriptor.ownerId} could not be activated`);
    }
  }
  return { activeOwnerIds, failures };
}

export function validateTrustedSystemModuleDescriptors(
  input: readonly TrustedSystemFrontendModuleDescriptorV1[],
): TrustedSystemFrontendModuleDescriptorV1[] {
  if (!Array.isArray(input) || input.length > 10) throw new Error('system_modules_invalid');
  const owners = new Set<string>();
  return input.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new Error('system_module_descriptor_invalid');
    const ownerId = candidate.ownerId?.trim();
    if (!ownerId || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(ownerId) || owners.has(ownerId)) throw new Error('system_module_owner_invalid');
    owners.add(ownerId);
    const url = new URL(candidate.entryPath, window.location.href);
    if (url.origin !== window.location.origin || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('.js')) throw new Error('system_module_entry_invalid');
    if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(candidate.integrity)) throw new Error('system_module_integrity_invalid');
    if (candidate.required !== undefined && typeof candidate.required !== 'boolean') throw new Error('system_module_required_invalid');
    return Object.freeze({ ownerId, entryPath: url.pathname, integrity: candidate.integrity, required: candidate.required === true });
  });
}

async function loadModuleScript(
  descriptor: TrustedSystemFrontendModuleDescriptorV1,
): Promise<TrustedSystemFrontendModuleV1> {
  let registered: TrustedSystemFrontendModuleV1 | undefined;
  const globalRecord = globalThis as Record<string, unknown>;
  const previous = globalRecord[SYSTEM_MODULE_REGISTRATION_GLOBAL];
  globalRecord[SYSTEM_MODULE_REGISTRATION_GLOBAL] = (module: unknown) => {
    if (registered || !module || typeof module !== 'object') throw new Error('system_module_registration_invalid');
    const candidate = module as TrustedSystemFrontendModuleV1;
    if (candidate.ownerId !== descriptor.ownerId || typeof candidate.activate !== 'function') throw new Error('system_module_registration_invalid');
    registered = candidate;
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = descriptor.entryPath;
      script.integrity = descriptor.integrity;
      script.crossOrigin = 'anonymous';
      script.onload = () => { script.remove(); resolve(); };
      script.onerror = () => { script.remove(); reject(new Error('system_module_load_failed')); };
      document.head.append(script);
    });
    if (!registered) throw new Error('system_module_registration_missing');
    return registered;
  } finally {
    if (previous === undefined) delete globalRecord[SYSTEM_MODULE_REGISTRATION_GLOBAL];
    else globalRecord[SYSTEM_MODULE_REGISTRATION_GLOBAL] = previous;
  }
}
