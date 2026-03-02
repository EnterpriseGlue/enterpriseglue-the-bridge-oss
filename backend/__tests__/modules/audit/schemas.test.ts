import { describe, it, expect } from 'vitest';
import * as auditSchemas from '../../../../packages/backend-host/src/modules/audit/schemas/index.js';

describe('audit schemas index', () => {
  it('exports audit schemas module', () => {
    expect(auditSchemas).toBeDefined();
  });
});
