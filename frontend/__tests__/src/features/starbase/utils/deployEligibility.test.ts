import { describe, expect, it } from 'vitest'
import { hasConnectedEngine } from '@src/features/starbase/utils/deployEligibility'

describe('deployEligibility', () => {
  const connectedEngineAccess = {
    accessedEngines: [{ engineId: 'engine-1', engineName: 'Dev Engine' }],
    pendingRequests: [],
    availableEngines: [],
  }

  it('returns true when the server exposes a deployment-eligible engine', () => {
    expect(hasConnectedEngine(connectedEngineAccess)).toBe(true)
  })

  it('returns false when there is no connected engine', () => {
    expect(hasConnectedEngine({ accessedEngines: [], pendingRequests: [], availableEngines: [] })).toBe(false)
  })

  it('excludes synthetic environment entries and denied deployment targets', () => {
    expect(hasConnectedEngine({
      accessedEngines: [
        { engineId: '__env__', engineName: 'Environment' },
        { engineId: 'engine-1', engineName: 'Dev Engine', manualDeployAllowed: false, ciDeployAllowed: false },
      ],
      pendingRequests: [],
      availableEngines: [],
    })).toBe(false)
  })
})
