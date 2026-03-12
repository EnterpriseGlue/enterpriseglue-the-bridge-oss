import { describe, expect, it } from 'vitest'
import { canDeployProject } from '@src/features/starbase/utils/deployEligibility'

describe('deployEligibility', () => {
  const connectedEngineAccess = {
    accessedEngines: [{ engineId: 'engine-1', engineName: 'Dev Engine' }],
    pendingRequests: [],
    availableEngines: [],
  }

  it('returns true when a default deploy role has a connected engine', () => {
    expect(
      canDeployProject(
        { role: 'owner', roles: ['owner'] },
        connectedEngineAccess,
        ['owner', 'delegate', 'operator', 'deployer']
      )
    ).toBe(true)
  })

  it('returns true for an editor with explicit deploy permission and a connected engine', () => {
    expect(
      canDeployProject(
        { role: 'editor', roles: ['editor'], deployAllowed: true },
        connectedEngineAccess,
        ['owner', 'delegate', 'operator', 'deployer']
      )
    ).toBe(true)
  })

  it('returns false when there is no connected engine', () => {
    expect(
      canDeployProject(
        { role: 'owner', roles: ['owner'] },
        { accessedEngines: [], pendingRequests: [], availableEngines: [] },
        ['owner', 'delegate', 'operator', 'deployer']
      )
    ).toBe(false)
  })

  it('returns false when the role is not deploy-eligible', () => {
    expect(
      canDeployProject(
        { role: 'viewer', roles: ['viewer'] },
        connectedEngineAccess,
        ['owner', 'delegate', 'operator', 'deployer']
      )
    ).toBe(false)
  })
})
