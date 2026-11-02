import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadMigrationSession,
  saveMigrationSession,
} from '@src/features/mission-control/migration-wizard/components/MigrationWizard'

describe('MigrationWizard session state', () => {
  beforeEach(() => sessionStorage.clear())

  it('persists the origin engine with selected instances and process identity', () => {
    saveMigrationSession({
      instanceIds: ['pi-1'],
      engineId: 'engine-a',
      selectedKey: 'orders',
      selectedVersion: 3,
    },'actor-a:tenant-a')

    expect(loadMigrationSession('actor-a:tenant-a')).toEqual({
      instanceIds: ['pi-1'],
      engineId: 'engine-a',
      selectedKey: 'orders',
      selectedVersion: 3,
    })
  })

  it('does not restore another actor/tenant or an unscoped legacy selection',()=>{
    const selection={instanceIds:['pi-a'],engineId:'engine-shared',selectedKey:'orders',selectedVersion:1};
    saveMigrationSession(selection,'actor-a:tenant-a');
    expect(loadMigrationSession('actor-b:tenant-a')).toEqual({instanceIds:[]});
    expect(loadMigrationSession('actor-a:tenant-b')).toEqual({instanceIds:[]});
    sessionStorage.setItem('migration-wizard-state',JSON.stringify(selection));
    expect(loadMigrationSession()).toEqual({instanceIds:[]});
  })

  it.each([{instanceIds:['pi-a']},{instanceIds:['pi-a','pi-a'],engineId:'engine-a'},{instanceIds:['pi-a'],engineId:'engine-a',selectedVersion:1.5},
    {instanceIds:'pi-a',engineId:'engine-a'},{instanceIds:['pi-a'],engineId:' engine-a'}])('does not persist malformed intent %j',input=>{
    saveMigrationSession(input as any,'scope');expect(loadMigrationSession('scope')).toEqual({instanceIds:[]});
  })
})
