import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { config } from '@enterpriseglue/shared/config/index.js';
import { installPostgresContextBoundary, TenantRlsSubscriber } from '@enterpriseglue/shared/infrastructure/persistence/subscribers/TenantRlsSubscriber.js';
import { runWithPlatformDatabaseCapability } from '@enterpriseglue/shared/services/platform-database-context.js';

const originalMode = config.tenancyMode;
afterEach(() => { config.tenancyMode = originalMode; });
function fixture() {
  const cursor = new PassThrough({objectMode:true});
  const runner = { isReleased:false, isTransactionActive:false, query:vi.fn(async (_sql: string, _parameters?: unknown[]) => []),
    stream:vi.fn(async () => cursor), release:vi.fn(async () => { runner.isReleased=true; }),
    releasePostgresConnection:vi.fn(async (_error:Error) => { runner.isReleased=true; }) };
  const source = {options:{type:'postgres'}, isInitialized:false, subscribers:[new TenantRlsSubscriber()], createQueryRunner:() => runner} as unknown as DataSource;
  const query = runner.query;
  const release = runner.release;
  installPostgresContextBoundary(source);
  return {runner:source.createQueryRunner(), cursor, query, release, discard:runner.releasePostgresConnection};
}
describe('single-mode cursor boundary', () => {
  it('rejects malformed runtime capability scalar and array bindings before work', async()=>{
    const work=vi.fn(async()=>true);
    for(const input of [{kind:'config-bootstrap',bundleKey:'bundle',providerKeys:'provider'}, {kind:'system-group-seed',groupIds:'group'},
      {kind:'provider-proof',providerId:['provider'],subjectId:'subject'}, {kind:'provider-account',providerId:'provider',subjectId:'subject'},
      {kind:'provider-discovery',extra:'binding'}]) await expect(runWithPlatformDatabaseCapability(input as any,work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
  });
  it('sets explicit single context and holds release until consumed/cleared', async () => {
    config.tenancyMode='single';
    const f=fixture();
    const cursor=await f.runner.stream('SELECT rows');
    expect(f.query).toHaveBeenNthCalledWith(1, expect.stringContaining('set_config'), ['single','','{}']);
    const releasing=f.runner.release();
    expect(f.release).not.toHaveBeenCalled();
    cursor.resume();
    f.cursor.end();
    await releasing;
    expect(f.query).toHaveBeenNthCalledWith(2, expect.stringContaining('set_config'), ['denied','','{}']);
    expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('clears an early-close cursor and admits the next query only after cleanup', async () => {
    config.tenancyMode='single';
    const f=fixture();
    await f.runner.stream('SELECT rows');
    const next=f.runner.query('SELECT later');
    expect(f.query).toHaveBeenCalledTimes(1);
    f.cursor.destroy();
    await next;
    await f.runner.release();
    expect(f.query.mock.calls.map(call => call[0])).toContain('SELECT later');
    expect(f.discard).not.toHaveBeenCalled();
  });
  it('quarantines error/cancellation with the actual cause and unblocks release', async () => {
    config.tenancyMode='single';
    const f=fixture();
    await f.runner.stream('SELECT rows');
    const cause=new Error('driver stream failure');
    f.cursor.destroy(cause);
    await f.runner.release();
    expect(f.discard).toHaveBeenCalledWith(cause);
    expect(f.release).not.toHaveBeenCalled();
  });
  it('does not expose a pooled stream or acquire its physical connection', async () => {
    config.tenancyMode='pooled';
    const f=fixture();
    await expect(f.runner.stream('SELECT rows')).rejects.toThrow('Pooled PostgreSQL streaming');
    expect(f.query).not.toHaveBeenCalled();
    await f.runner.release();
  });
});
