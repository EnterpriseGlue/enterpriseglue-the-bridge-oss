import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ConfigEngineSchema,
  ConfigIdentityProviderSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';

const DOCUMENTS = [
  'docs/how-to/configure-authorization-and-engines.md',
  'docs/how-to/deploy-authorization-config.md',
] as const;

const SCHEMAS: Record<string, z.ZodType> = {
  ConfigEngineSchema,
  ConfigIdentityProviderSchema,
};

const repoRoot = resolve(import.meta.dirname, '../../../../..');
const taggedJsonBlock = /<!--\s*enterpriseglue-config-schema:\s*([A-Za-z0-9_]+)\s*-->\s*```json\s*\n([\s\S]*?)\n```/g;
const jsonFence = /^```json\s*$/gm;

describe('published configuration JSON examples', () => {
  for (const documentPath of DOCUMENTS) {
    it(`${documentPath} stays synchronized with shared schemas`, () => {
      const markdown = readFileSync(resolve(repoRoot, documentPath), 'utf8');
      const matches = [...markdown.matchAll(taggedJsonBlock)];

      expect(matches.length, 'every JSON block must have an enterpriseglue-config-schema annotation')
        .toBe([...markdown.matchAll(jsonFence)].length);
      expect(matches.length, 'the guide must retain at least one executable JSON example').toBeGreaterThan(0);

      for (const match of matches) {
        const [, schemaName, source] = match;
        const schema = SCHEMAS[schemaName];
        expect(schema, `unknown schema annotation ${schemaName}`).toBeDefined();

        let example: unknown;
        expect(() => { example = JSON.parse(source); }, `${documentPath} contains malformed JSON`).not.toThrow();
        const result = schema.safeParse(example);
        expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues, null, 2)).toBe(true);
      }
    });
  }
});
