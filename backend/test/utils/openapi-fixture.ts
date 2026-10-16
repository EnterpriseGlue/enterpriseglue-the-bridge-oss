import { beforeAll } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

/** Generate the real, static contract once per suite; each assertion gets an isolated copy. */
export function useOpenApiFixture(): () => ReturnType<typeof generateOpenApi> {
  let document: ReturnType<typeof generateOpenApi>;
  beforeAll(() => { document = generateOpenApi(); });
  return () => structuredClone(document);
}
