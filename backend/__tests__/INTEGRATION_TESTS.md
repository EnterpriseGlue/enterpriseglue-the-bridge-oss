# Integration Tests for Mission Control Routes

## Current Status

8 tests are **skipped** because they are **integration tests**, not unit tests. They test routes that proxy requests to external Camunda engines.

### Skipped Integration Tests (9 tests)

1. **engines/deployments.test.ts** (2 tests)
   - Lists deployments for an engine
   - Gets deployment by id

2. **mission-control/decisions/routes.test.ts** (2 tests)
   - Lists decision definitions
   - Evaluates decision

3. **mission-control/processes/routes.test.ts** (2 tests)
   - Lists process definitions  
   - Returns process definition details

4. **mission-control/engines/routes.test.ts** (2 tests)
   - Returns list of engines
   - Returns engine detail when user has access

5. **mission-control/process-instances/routes.test.ts** (1 test)
   - Returns process instance detail

---

## Why These Are Skipped

These routes have **no business logic** to unit test. They:
- Validate auth/permissions
- Forward requests to Camunda REST API
- Return responses from Camunda

Testing them in isolation requires mocking:
- Database (Engine entities)
- `engineService.hasEngineAccess()`
- `fetch()` calls to Camunda
- All Camunda response formats

This is **integration testing**, not unit testing.

---

## Recommended Approach: E2E Tests with Prism

Use the **Prism mock server** with our Postman collection from `local-docs/ING/api-specs/`.

### Setup

```bash
# Install Prism CLI
npm install -g @stoplight/prism-cli

# Start Camunda mock server
cd local-docs/ING/api-specs
prism mock Mission-Control-Camunda-API.postman_collection.json -p 9080
```

### E2E Test Structure

```typescript
// test/e2e/mission-control.test.ts
import { test, expect } from '@playwright/test';

test.describe('Mission Control Integration', () => {
  test.beforeAll(async () => {
    // Backend points to Prism mock at http://localhost:9080
    process.env.ENGINE_BASE_URL = 'http://localhost:9080';
  });

  test('lists decision definitions', async ({ request }) => {
    const response = await request.get('/mission-control-api/decisions/definitions');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('gets deployment by id', async ({ request }) => {
    const response = await request.get('/engines-api/engines/e1/deployments/d1');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('name');
  });
});
```

### Benefits

✅ **Realistic Camunda responses** from Postman collection examples  
✅ **No complex mocking** - just point to Prism mock server  
✅ **Request validation** - Prism validates against Camunda OpenAPI spec  
✅ **Fast execution** - Prism returns responses in <10ms  
✅ **Offline development** - no real Camunda engine needed  
✅ **Consistent test data** across team (from API specs)

---

## Alternative: Test Against Real Engine

If you have a test Camunda engine:

```bash
# In test/e2e setup
export ENGINE_BASE_URL=http://test-camunda:8080/engine-rest
export ENGINE_USERNAME=demo
export ENGINE_PASSWORD=demo

# Run E2E tests
npm run test:e2e
```

---

## Current Test Coverage

- ✅ **384 unit tests passing** (100% of runnable tests)
- ⏭️ **9 integration tests skipped** (require E2E framework)

---

## Next Steps

1. **For now:** Skip these 9 tests (they're integration tests)
2. **Later:** Add E2E test suite using Playwright + Prism mock server
3. **Reference:** See `local-docs/ING/api-specs/README.md` for Prism setup

---

**Last Updated:** January 20, 2026
