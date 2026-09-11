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
    })

    expect(loadMigrationSession()).toEqual({
      instanceIds: ['pi-1'],
      engineId: 'engine-a',
      selectedKey: 'orders',
      selectedVersion: 3,
    })
  })
})
