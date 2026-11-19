import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('dashboard API contracts', () => {
  it.each([
    ['context', 'runtimeScopedEngineIds', 'array'],
    ['stats', 'totalProjects', 'integer'],
  ])('documents the registered GET %s operation', (route, field, type) => {
    const path = `/api/dashboard/${route}`;
    const source = readFileSync(new URL(
      `../../../../packages/backend-host/src/modules/dashboard/routes/${route}.ts`,
      import.meta.url,
    ), 'utf8');
    expect(source).toContain(`.get('${path}', requireAuth, requireAction('platform.dashboard.read')`);

    const document = generateOpenApi();
    expect(document.paths?.[path]?.get?.responses?.['200']).toMatchObject({
      content: { 'application/json': { schema: { type: 'object', properties: { [field]: { type } } } } },
    });
  });
});
