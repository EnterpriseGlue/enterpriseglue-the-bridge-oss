/**
 * Presentation-only engine shape returned by the engine selector endpoint.
 * Runtime resource records themselves always use the shared API contract.
 */
export type RuntimeResourceEngineOption = {
  id: string;
  name: string;
  status?: string;
};
