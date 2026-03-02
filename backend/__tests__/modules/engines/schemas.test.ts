import { describe, it, expect } from 'vitest';
import * as enginesSchemas from '../../../../packages/backend-host/src/modules/engines/schemas/index.js';

describe('engines schemas index', () => {
  it('loads engines schemas module', () => {
    expect(enginesSchemas).toBeDefined();
  });
});
