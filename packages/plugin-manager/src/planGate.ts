import { resolve } from 'node:path';

import {
  parsePluginLifecyclePlanEnvelopeV1,
  pluginLifecyclePlanFileName,
  type PluginLifecyclePlanEnvelopeV1,
} from '@enterpriseglue/plugin-installer';

import { readManagerSecureTextFileV1 } from './secureFile.js';

export async function assertPreparedPluginPlanMatchesV1(
  outputRoot: string,
  approved: PluginLifecyclePlanEnvelopeV1,
): Promise<void> {
  const path = resolve(outputRoot, pluginLifecyclePlanFileName);
  const text = await readManagerSecureTextFileV1(path, 1024 ** 2);
  if (text.length < 1) {
    throw new Error('verified_package_plan_file_invalid');
  }
  const prepared = parsePluginLifecyclePlanEnvelopeV1(
    JSON.parse(text),
  );
  if (prepared.planSha256 !== approved.planSha256) {
    throw new Error('verified_package_plan_mismatch');
  }
}
