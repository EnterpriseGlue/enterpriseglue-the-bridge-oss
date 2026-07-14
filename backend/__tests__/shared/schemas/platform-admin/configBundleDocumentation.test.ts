import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ConfigEngineSchema,
  ConfigIdentityProviderSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';

const SCHEMAS: Record<string, z.ZodType> = {
  ConfigEngineSchema,
  ConfigIdentityProviderSchema,
};

const repoRoot = resolve(import.meta.dirname, '../../../../..');
const taggedJsonBlock = /<!--\s*enterpriseglue-config-schema:\s*([A-Za-z0-9_]+)\s*-->\s*```json\s*\n([\s\S]*?)\n```/g;
const jsonFence = /^```json\s*$/gm;
const DOCUMENTS = readdirSync(resolve(repoRoot, 'docs/how-to'), { recursive: true })
  .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.md'))
  .map((entry) => `docs/how-to/${entry}`)
  .filter((documentPath) => readFileSync(resolve(repoRoot, documentPath), 'utf8').includes('```json'))
  .sort();

describe('published configuration JSON examples', () => {
  it('discovers every executable JSON example in the published how-to guides', () => {
    expect(DOCUMENTS.length).toBeGreaterThan(0);
  });

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
