import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  parsePluginLifecyclePlanEnvelopeV1,
  pluginLifecyclePlanFileName,
  type PluginLifecyclePlanEnvelopeV1,
} from '@enterpriseglue/plugin-installer';

export async function assertPreparedPluginPlanMatchesV1(
  outputRoot: string,
  approved: PluginLifecyclePlanEnvelopeV1,
): Promise<void> {
  const path = resolve(outputRoot, pluginLifecyclePlanFileName);
  const details = await lstat(path);
  if (
    !details.isFile() ||
    details.isSymbolicLink() ||
    details.size < 1 ||
    details.size > 1024 ** 2
  ) {
    throw new Error('verified_package_plan_file_invalid');
  }
  const prepared = parsePluginLifecyclePlanEnvelopeV1(
    JSON.parse(await readFile(path, 'utf8')),
  );
  if (prepared.planSha256 !== approved.planSha256) {
    throw new Error('verified_package_plan_mismatch');
  }
}
