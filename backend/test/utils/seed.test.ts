import {beforeEach,describe,expect,it,vi} from 'vitest';
import {getDataSource} from '@enterpriseglue/shared/db/data-source.js';
import {authzGroupService} from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import {permissionService} from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import {seedUser} from './seed.js';

vi.mock('@enterpriseglue/shared/db/data-source.js',()=>({getDataSource:vi.fn()}));
vi.mock('@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js',()=>({authzGroupService:{seedDefaultPlatformGroups:vi.fn(),ensureAuthenticatedUserMembershipWithManager:vi.fn()}}));
vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js',()=>({permissionService:{seedRbacFoundation:vi.fn()}}));

describe('concurrent authorization fixture initialization',()=>{
  beforeEach(()=>{
    vi.resetAllMocks();
    const manager={getRepository:()=>({insert:vi.fn().mockResolvedValue({})})};
    vi.mocked(getDataSource).mockResolvedValue({transaction:async(work:(value:unknown)=>Promise<void>)=>work(manager)} as never);
    vi.mocked(permissionService.seedRbacFoundation).mockResolvedValue(undefined as never);
    vi.mocked(authzGroupService.seedDefaultPlatformGroups).mockResolvedValue({groups:0,assignments:0});
  });
  it('prepares one foundation for simultaneous users and retains successful initialization',async()=>{
    const releases:Array<()=>void>=[];
    vi.mocked(permissionService.seedRbacFoundation).mockImplementation(()=>new Promise<void>(resolve=>{releases.push(resolve);}) as never);
    const pending=Promise.all(['one','two','three'].map(name=>seedUser('fixture-'+name)));
    await vi.waitFor(()=>expect(permissionService.seedRbacFoundation).toHaveBeenCalled());
    const calls=vi.mocked(permissionService.seedRbacFoundation).mock.calls.length;
    // Release every waiter even against the old implementation so failure is bounded.
    releases.forEach(release=>release());
    const users=await pending;
    expect(calls).toBe(1);
    expect(new Set(users.map(user=>user.id)).size).toBe(3);
    expect(authzGroupService.seedDefaultPlatformGroups).toHaveBeenCalledTimes(1);
    await seedUser('fixture-four');expect(permissionService.seedRbacFoundation).toHaveBeenCalledTimes(1);
  });
  it('allows initialization to be retried after a failed setup',async()=>{
    vi.mocked(permissionService.seedRbacFoundation).mockRejectedValueOnce(new Error('setup failed'));
    await expect(seedUser('fixture-first')).rejects.toThrow('setup failed');
    await expect(seedUser('fixture-retry')).resolves.toHaveProperty('id');
    expect(permissionService.seedRbacFoundation).toHaveBeenCalledTimes(2);
    expect(authzGroupService.seedDefaultPlatformGroups).toHaveBeenCalledTimes(1);
  });
});
