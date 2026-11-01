import { describe, it, expect } from 'vitest';
import * as versioningSchemas from '../../../../packages/backend-host/src/modules/versioning/schemas/index.js';
import { commitBodySchema } from '@enterpriseglue/shared/schemas/common.js';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('versioning schemas index', () => {
  it('loads versioning schemas module', () => {
    expect(versioningSchemas).toBeDefined();
  });

  it('documents and validates the same nonempty, distinct file scope', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    expect(commitBodySchema.parse({ message: 'Project save' })).toEqual({ message: 'Project save' });
    expect(commitBodySchema.parse({ message: 'File save', fileIds: [id] }).fileIds).toEqual([id]);
    for (const fileIds of [[], [id, id], ['not-a-uuid'], null]) {
      expect(commitBodySchema.safeParse({ message: 'Invalid scope', fileIds }).success).toBe(false);
    }
    const schema = generateOpenApi().paths['/vcs-api/projects/{projectId}/commit'].post.requestBody.content['application/json'].schema;
    expect(schema.properties.fileIds.minItems).toBe(1);
    expect(schema.properties.fileIds.items.format).toBe('uuid');
  });
});
