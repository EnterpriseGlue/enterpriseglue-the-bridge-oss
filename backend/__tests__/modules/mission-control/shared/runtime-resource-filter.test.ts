import { beforeEach, describe, expect, it, vi } from 'vitest';
import { camundaGet } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import {
  filterRuntimeItemsByProcessDefinitionKeys,
  filterRuntimeItemsByResourceKey,
  getAuthorizedRuntimeTenantIdForKey,
  getBoundedRuntimeFetchAndLockRequest,
  getBoundedRuntimeResourceQuery,
  MAX_RUNTIME_RESOURCE_PAGE_SIZE,
  withAuthorizedRuntimeTenantQuery,
} from '../../../../../packages/backend-host/src/modules/mission-control/shared/runtime-resource-filter.js';

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  camundaGet: vi.fn(),
}));

describe('runtime resource tenant filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps dedicated engine exact operations unscoped', () => {
    expect(getAuthorizedRuntimeTenantIdForKey(undefined, 'invoice')).toBeUndefined();
  });

  it('returns the one mapped runtime tenant, including the no-tenant partition', () => {
    expect(getAuthorizedRuntimeTenantIdForKey([
      { resourceKey: 'invoice', runtimeTenantId: 'runtime-a' },
    ], 'invoice')).toBe('runtime-a');
    expect(getAuthorizedRuntimeTenantIdForKey([
      { resourceKey: 'invoice', runtimeTenantId: '' },
    ], 'invoice')).toBe('');
  });

  it('fails closed when an exact key has no scope or more than one runtime tenant', () => {
    expect(() => getAuthorizedRuntimeTenantIdForKey([
      { resourceKey: 'other', runtimeTenantId: 'runtime-a' },
    ], 'invoice')).toThrow('requires one resolved runtime tenant scope');
    expect(() => getAuthorizedRuntimeTenantIdForKey([
      { resourceKey: 'invoice', runtimeTenantId: 'runtime-a' },
      { resourceKey: 'invoice', runtimeTenantId: 'runtime-b' },
    ], 'invoice')).toThrow('requires one resolved runtime tenant scope');
  });

  it('replaces caller tenant filters with the authorized runtime scope', () => {
    expect(withAuthorizedRuntimeTenantQuery(
      { tenantIdIn: ['injected'], withoutTenantId: true, maxResults: 25 },
      [{ resourceKey: 'invoice', runtimeTenantId: 'runtime-a' }],
      'invoice',
    )).toEqual({ tenantIdIn: ['runtime-a'], maxResults: 25 });
  });

  it('keeps collection query filters unchanged without resource scopes', () => {
    expect(withAuthorizedRuntimeTenantQuery(
      { tenantIdIn: ['caller'], withoutTenantId: true },
      undefined,
      'invoice',
    )).toEqual({ tenantIdIn: ['caller'], withoutTenantId: true });
  });

  it('combines unique tenant and no-tenant scopes for collection reads', () => {
    expect(withAuthorizedRuntimeTenantQuery(
      { tenantIdIn: ['caller'], withoutTenantId: false, maxResults: 10 },
      [
        { resourceKey: 'invoice', runtimeTenantId: 'runtime-a' },
        { resourceKey: 'invoice', runtimeTenantId: 'runtime-a' },
        { resourceKey: 'invoice', runtimeTenantId: '' },
        { resourceKey: 'other', runtimeTenantId: 'runtime-b' },
      ],
      'invoice',
    )).toEqual({
      tenantIdIn: ['runtime-a'],
      withoutTenantId: true,
      maxResults: 10,
    });
    expect(withAuthorizedRuntimeTenantQuery(
      { maxResults: 10 },
      [{ resourceKey: 'invoice', runtimeTenantId: '' }],
      'invoice',
    )).toEqual({ withoutTenantId: true, maxResults: 10 });
  });

  it.each([
    ['text', 'maxResults'],
    [1.5, 'maxResults'],
    [0, 'maxResults'],
    [MAX_RUNTIME_RESOURCE_PAGE_SIZE + 1, 'maxResults'],
  ])('rejects invalid bounded runtime query value %s', (value, key) => {
    expect(() => getBoundedRuntimeResourceQuery({ [key]: value }))
      .toThrow('maxResults between 1 and 100');
  });

  it('normalizes bounded runtime query defaults and numeric strings', () => {
    expect(getBoundedRuntimeResourceQuery({ key: 'invoice' })).toEqual({
      key: 'invoice',
      maxResults: 100,
    });
    expect(getBoundedRuntimeResourceQuery({ maxResults: '25' })).toEqual({
      maxResults: 25,
    });
  });

  it.each(['text', 1.5, 0, MAX_RUNTIME_RESOURCE_PAGE_SIZE + 1])(
    'rejects invalid bounded fetch-and-lock value %s',
    (maxTasks) => {
      expect(() => getBoundedRuntimeFetchAndLockRequest({ maxTasks }))
        .toThrow('maxTasks between 1 and 100');
    },
  );

  it('normalizes bounded fetch-and-lock defaults and numeric strings', () => {
    expect(getBoundedRuntimeFetchAndLockRequest({ workerId: 'worker-1' })).toEqual({
      workerId: 'worker-1',
      maxTasks: 100,
    });
    expect(getBoundedRuntimeFetchAndLockRequest({ maxTasks: '5' })).toEqual({
      maxTasks: 5,
    });
  });

  it('filters direct runtime keys and exact runtime tenant identity', () => {
    const items = [
      { key: 'invoice', tenantId: 'runtime-a' },
      { key: 'invoice' },
      { key: 'other', tenantId: 'runtime-a' },
      { key: 42, tenantId: 'runtime-a' },
    ];
    expect(filterRuntimeItemsByResourceKey(items, undefined, 'key')).toEqual(items);
    expect(filterRuntimeItemsByResourceKey(items, ['invoice'], 'key')).toEqual(items.slice(0, 2));
    expect(filterRuntimeItemsByResourceKey(items, ['invoice'], 'key', [
      { resourceKey: 'invoice', runtimeTenantId: 'runtime-a' },
    ])).toEqual([items[0]]);
    expect(filterRuntimeItemsByResourceKey(items, ['invoice'], 'key', [
      { resourceKey: 'invoice', runtimeTenantId: '' },
    ])).toEqual([items[1]]);
  });

  it('rejects an unbounded direct-key engine response', () => {
    expect(() => filterRuntimeItemsByResourceKey(
      Array.from({ length: 101 }, (_, index) => ({ key: `key-${index}` })),
      ['invoice'],
      'key',
    )).toThrow('unbounded runtime collection');
  });

  it('returns an unscoped process-definition collection unchanged', async () => {
    const items = [{ processDefinitionId: 'definition-1' }];
    await expect(filterRuntimeItemsByProcessDefinitionKeys(
      'engine-1',
      items,
      undefined,
    )).resolves.toBe(items);
    expect(camundaGet).not.toHaveBeenCalled();
  });

  it('rejects an unbounded process-definition lineage response', async () => {
    await expect(filterRuntimeItemsByProcessDefinitionKeys(
      'engine-1',
      Array.from({ length: 101 }, (_, index) => ({ processDefinitionKey: `key-${index}` })),
      ['invoice'],
    )).rejects.toThrow('unbounded runtime collection');
  });

  it('filters direct and resolved process-definition lineage', async () => {
    vi.mocked(camundaGet)
      .mockResolvedValueOnce({ key: 'invoice', tenantId: 'runtime-a' })
      .mockResolvedValueOnce({ key: 42 });
    const items = [
      { id: 'direct', processDefinitionKey: 'invoice', tenantId: 'runtime-a' },
      { id: 'definition-key', definitionKey: 'invoice' },
      { id: 'resolved', processDefinitionId: 'definition-1' },
      { id: 'resolved-invalid-key', definitionId: 'definition-2' },
      { id: 'missing-id', definitionId: 42 },
      { id: 'denied', processDefinitionKey: 'other' },
    ];

    const result = await filterRuntimeItemsByProcessDefinitionKeys(
      'engine-1',
      items,
      ['invoice'],
    );

    expect(result.map((item) => item.id)).toEqual([
      'direct',
      'definition-key',
      'resolved',
    ]);
    expect(camundaGet).toHaveBeenNthCalledWith(
      1,
      'engine-1',
      '/process-definition/definition-1',
    );
    expect(camundaGet).toHaveBeenNthCalledWith(
      2,
      'engine-1',
      '/process-definition/definition-2',
    );
  });

  it('uses item or resolved-definition tenant lineage for scoped process rows', async () => {
    vi.mocked(camundaGet)
      .mockResolvedValueOnce({ key: 'invoice', tenantId: 'runtime-a' })
      .mockResolvedValueOnce({ key: 'invoice' })
      .mockResolvedValueOnce({ key: 'invoice', tenantId: 'runtime-b' });
    const items = [
      { id: 'direct-tenant', processDefinitionKey: 'invoice', tenantId: 'runtime-a' },
      { id: 'definition-tenant', processDefinitionId: 'definition-1' },
      { id: 'definition-no-tenant', definitionId: 'definition-2', tenantId: 'wrong' },
      { id: 'definition-wrong-tenant', definitionId: 'definition-3', tenantId: 'wrong' },
      { id: 'wrong-tenant', processDefinitionKey: 'invoice', tenantId: 'runtime-b' },
    ];

    const result = await filterRuntimeItemsByProcessDefinitionKeys(
      'engine-1',
      items,
      ['invoice'],
      [
        { resourceKey: 'invoice', runtimeTenantId: 'runtime-a' },
        { resourceKey: 'invoice', runtimeTenantId: '' },
      ],
    );

    expect(result.map((item) => item.id)).toEqual([
      'direct-tenant',
      'definition-tenant',
      'definition-no-tenant',
    ]);
  });
});
