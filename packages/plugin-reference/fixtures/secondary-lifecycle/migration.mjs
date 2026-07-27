import {
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';

const pluginId =
  'io.enterpriseglue.reference-health-secondary';
const storageRoot =
  '/var/lib/enterpriseglue/reference-health';
const payloadPath = `${storageRoot}/payload.txt`;
const statePath = `${storageRoot}/migration-state.json`;

const configuredPluginId = required(
  'ENTERPRISEGLUE_PLUGIN_ID',
);
const operation = required(
  'ENTERPRISEGLUE_PLUGIN_OPERATION',
);
const fromSchema = boundedSchema(
  'ENTERPRISEGLUE_PLUGIN_FROM_SCHEMA',
);
const toSchema = boundedSchema(
  'ENTERPRISEGLUE_PLUGIN_TO_SCHEMA',
);
const idempotencyKey = required(
  'ENTERPRISEGLUE_PLUGIN_IDEMPOTENCY_KEY',
);

if (configuredPluginId !== pluginId) {
  throw new Error('Migration fixture plugin identity mismatch');
}
if (operation !== 'upgrade' && operation !== 'rollback') {
  throw new Error('Migration fixture operation is invalid');
}
if (
  idempotencyKey.length > 512 ||
  !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
) {
  throw new Error('Migration fixture idempotency key is invalid');
}

const payload = await readFile(payloadPath, 'utf8');
if (payload !== 'secondary-lifecycle-payload-v1\n') {
  throw new Error('Migration fixture payload is missing or changed');
}

if (
  operation === 'upgrade' &&
  fromSchema === 0 &&
  toSchema === 2
) {
  throw new Error('Synthetic migration failure requested');
}
if (
  !(
    (operation === 'upgrade' &&
      fromSchema === 0 &&
      toSchema === 1) ||
    (operation === 'rollback' &&
      fromSchema === 1 &&
      toSchema === 0) ||
    (operation === 'rollback' &&
      fromSchema === 2 &&
      toSchema === 0)
  )
) {
  throw new Error('Migration fixture schema transition is invalid');
}

const state = {
  schemaVersion: 1,
  pluginId,
  dataSchema: toSchema,
  operation,
  idempotencyKey,
};
const temporary = `${statePath}.tmp`;
await writeFile(
  temporary,
  `${JSON.stringify(state)}\n`,
  { mode: 0o600 },
);
await rename(temporary, statePath);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boundedSchema(name) {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value < 0 || value > 2) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}
