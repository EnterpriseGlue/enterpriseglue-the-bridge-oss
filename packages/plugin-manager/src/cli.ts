#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { importPluginOfflineDeliveryV1 } from './offlineDeliveryImport.js';
import { reconcilePluginDesiredStateV1 } from './gitOps.js';
import { runPluginManagerMainV1 } from './main.js';
import { readManagerSecureTextFileV1 } from './secureFile.js';

function argumentsMap(values: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error('plugin_manager_command_arguments_invalid');
    }
    parsed[name.slice(2)] = value;
  }
  return parsed;
}

function required(values: Record<string, string>, name: string): string {
  const value = values[name]?.trim();
  if (!value) throw new Error(`plugin_manager_${name}_required`);
  return value;
}

export async function runPluginManagerCliV1(
  argv = process.argv.slice(2),
  write: (value: string) => void = console.log,
): Promise<number> {
  const [command = 'serve', ...rest] = argv;
  if (command === 'serve') {
    await runPluginManagerMainV1();
    return 0;
  }
  if (command === 'import-delivery') {
    const values = argumentsMap(rest);
    const receipt = await importPluginOfflineDeliveryV1({
      deliveryRoot: required(values, 'delivery'),
      intakeRoot: required(values, 'intake'),
      trustFile: required(values, 'trust'),
      maximumBytes: values['max-bytes']
        ? Number(values['max-bytes'])
        : undefined,
    });
    write(JSON.stringify(receipt));
    return 0;
  }
  if (command === 'reconcile') {
    const values = argumentsMap(rest);
    const result = await reconcilePluginDesiredStateV1({
      baseUrl: required(values, 'host'),
      accessToken: await readManagerSecureTextFileV1(
        required(values, 'token-file'),
        16 * 1024,
      ),
      desired: JSON.parse(
        await readManagerSecureTextFileV1(
          required(values, 'desired'),
          5 * 1024 ** 2,
        ),
      ),
    });
    write(JSON.stringify(result));
    return result.status === 'operation_in_progress' ? 2 : 0;
  }
  if (command === 'help' || command === '--help') {
    write(
      [
        'eg-plugin-manager serve',
        'eg-plugin-manager import-delivery --delivery DIR --intake DIR --trust FILE [--max-bytes BYTES]',
        'eg-plugin-manager reconcile --host URL --token-file FILE --desired FILE',
      ].join('\n'),
    );
    return 0;
  }
  throw new Error('plugin_manager_command_unknown');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPluginManagerCliV1().catch((error: unknown) => {
    const code =
      error instanceof Error &&
      /^[a-z0-9_]+$/.test(error.message) &&
      error.message.length <= 100
        ? error.message
        : 'plugin_manager_command_failed';
    console.error(code);
    process.exitCode = 1;
  });
}
