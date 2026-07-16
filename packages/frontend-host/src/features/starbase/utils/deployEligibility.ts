import type {
  ProjectEngineAccessedEngine,
  ProjectEngineAccessResponse,
} from '@enterpriseglue/shared/schemas/starbase/project-engine-access.js'

export type ConnectedEngine = ProjectEngineAccessedEngine
export type ProjectEngineAccessData = ProjectEngineAccessResponse

export function hasConnectedEngine(engineAccess: ProjectEngineAccessData | null | undefined): boolean {
  const connectedEngines = Array.isArray(engineAccess?.accessedEngines) ? engineAccess.accessedEngines : []
  return connectedEngines.some((engine) => (
    Boolean(engine.engineId) &&
    engine.engineId !== '__env__' &&
    (engine.manualDeployAllowed !== false || engine.ciDeployAllowed === true)
  ))
}
