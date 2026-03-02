import { describe, it, expect } from 'vitest';
import * as camundaServices from '@enterpriseglue/shared/services/camunda/index.js';

describe('camunda service exports', () => {
  it('exports camunda helpers', () => {
    expect(camundaServices).toHaveProperty('camundaGet');
    expect(camundaServices).toHaveProperty('camundaPost');
    expect(camundaServices).toHaveProperty('camundaDelete');
  });
});
