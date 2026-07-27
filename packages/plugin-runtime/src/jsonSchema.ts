import { createHash, timingSafeEqual } from 'node:crypto';

import {
  Ajv2020,
  type AnySchema,
  type ValidateFunction,
} from 'ajv/dist/2020.js';

import { PluginGatewayError } from './gateway.js';

export const PLUGIN_OPERATION_SCHEMA_MAX_BYTES = 256 * 1024;
const PLUGIN_OPERATION_SCHEMA_MAX_DEPTH = 64;
const PLUGIN_OPERATION_SCHEMA_MAX_NODES = 20_000;
const JSON_SCHEMA_2020_12 =
  'https://json-schema.org/draft/2020-12/schema';

export type PluginOperationPayloadDirectionV1 = 'request' | 'response';

export interface PluginOperationSchemaCompilerInputV1 {
  bytes: Uint8Array;
  expectedSha256: string;
  direction: PluginOperationPayloadDirectionV1;
}

export interface CompiledPluginOperationSchemaV1 {
  readonly sha256: string;
  readonly direction: PluginOperationPayloadDirectionV1;
  assert(value: unknown): void;
}

/**
 * Compile one digest-bound, self-contained JSON Schema document.
 *
 * Plugin schemas are immutable bundle resources. Remote references are denied so
 * validation never performs network I/O or depends on mutable external content.
 * Structural limits bound compilation work before Ajv sees the document.
 */
export function compilePluginOperationSchemaV1(
  input: PluginOperationSchemaCompilerInputV1,
): CompiledPluginOperationSchemaV1 {
  if (
    input.bytes.byteLength === 0 ||
    input.bytes.byteLength > PLUGIN_OPERATION_SCHEMA_MAX_BYTES
  ) {
    throw new PluginGatewayError(
      'schema_document_invalid',
      'Plugin operation schema has an invalid size',
    );
  }
  const actualSha256 = createHash('sha256').update(input.bytes).digest('hex');
  if (
    actualSha256.length !== input.expectedSha256.length ||
    !timingSafeEqual(
      Buffer.from(actualSha256, 'ascii'),
      Buffer.from(input.expectedSha256, 'ascii'),
    )
  ) {
    throw new PluginGatewayError(
      'schema_digest_invalid',
      'Plugin operation schema differs from the signed manifest',
    );
  }

  let schema: unknown;
  try {
    schema = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(input.bytes),
    );
  } catch {
    throw new PluginGatewayError(
      'schema_document_invalid',
      'Plugin operation schema is not valid UTF-8 JSON',
    );
  }
  assertBoundedSelfContainedSchema(schema);

  let validate: ValidateFunction;
  try {
    const ajv = new Ajv2020({
      strict: true,
      allErrors: false,
      verbose: false,
      messages: false,
      validateFormats: false,
      allowUnionTypes: false,
      $data: false,
      removeAdditional: false,
      useDefaults: false,
      coerceTypes: false,
      ownProperties: true,
      code: {
        source: false,
        optimize: true,
      },
    });
    validate = ajv.compile(schema as AnySchema);
  } catch {
    throw new PluginGatewayError(
      'schema_document_invalid',
      'Plugin operation schema cannot be compiled safely',
    );
  }

  return Object.freeze({
    sha256: actualSha256,
    direction: input.direction,
    assert(value: unknown): void {
      if (!validate(value)) {
        throw new PluginGatewayError(
          input.direction === 'request'
            ? 'request_schema_invalid'
            : 'response_schema_invalid',
          `Plugin ${input.direction} does not satisfy its signed schema`,
        );
      }
    },
  });
}

function assertBoundedSelfContainedSchema(schema: unknown): void {
  if (
    !schema ||
    typeof schema !== 'object' ||
    Array.isArray(schema) ||
    (schema as Record<string, unknown>).$schema !== JSON_SCHEMA_2020_12
  ) {
    throw new PluginGatewayError(
      'schema_document_invalid',
      'Plugin operation schema must be a draft 2020-12 object schema',
    );
  }

  const pending: Array<{ value: unknown; depth: number }> = [
    { value: schema, depth: 0 },
  ];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (
      nodes > PLUGIN_OPERATION_SCHEMA_MAX_NODES ||
      current.depth > PLUGIN_OPERATION_SCHEMA_MAX_DEPTH
    ) {
      throw new PluginGatewayError(
        'schema_document_invalid',
        'Plugin operation schema exceeds structural limits',
      );
    }
    if (!current.value || typeof current.value !== 'object') continue;
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    for (const [key, value] of Object.entries(
      current.value as Record<string, unknown>,
    )) {
      if (
        (key === '$ref' || key === '$dynamicRef') &&
        (typeof value !== 'string' || !value.startsWith('#'))
      ) {
        throw new PluginGatewayError(
          'schema_document_invalid',
          'Plugin operation schemas may use only local references',
        );
      }
      pending.push({ value, depth: current.depth + 1 });
    }
  }
}
