import { describe, it, expect } from 'vitest';
import * as auditModule from '../../../../packages/backend-host/src/modules/audit/index.js';

describe('audit module index', () => {
  it('exports audit route', () => {
    expect(auditModule).toHaveProperty('auditRoute');
  });
});
